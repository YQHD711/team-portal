using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 房间布局保存的并发保护。
///
/// 实测背景：改之前 `PUT /api/storage/layouts/{id}` 是"读-覆盖-写"，没有任何版本比对 ——
/// 两个客户端各自加载同一房间后依次保存，**后保存的把先保存的改动整段抹掉**
/// （实验：A 的 `FROM_A` 元素在 B 保存后完全消失）。这里把四种情形钉住。
/// </summary>
public class LayoutConcurrencyTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public LayoutConcurrencyTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    private static string LayoutJson(string marker) =>
        $"{{\"width\":900,\"height\":600,\"items\":[{{\"id\":\"it1\",\"name\":\"{marker}\"}}]}}";

    private static object SaveBody(string marker, int? expectedVersion, bool? force = null) => new
    {
        roomCode = "1097", roomName = "并发实验房", floor = 1,
        cabinetCount = 1, shelfCount = 1, positionCount = 1,
        description = marker, layoutJson = LayoutJson(marker),
        expectedVersion, force
    };

    private async Task<(HttpClient Client, string DbPath, int LayoutId)> SetupAsync()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-layout-cc-{Guid.NewGuid():N}.db");
        // 每个测试独立 host；**不调登录接口**（限流 5 次/60 秒/IP，会让并行测试互相打成 429），直接签发 token
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", TestToken.JwtKey);
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Database.Migrate();
            seed.Users.Add(new User
            {
                Id = 1, Username = "planner", PasswordHash = "x", Role = "admin",
            });
            await seed.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new("Bearer", TestToken.Make(1, "planner", "admin"));

        var created = await client.PostAsJsonAsync("/api/storage/layouts", SaveBody("initial", null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var layout = await created.Content.ReadFromJsonAsync<StorageLayout>();
        Assert.NotNull(layout);
        Assert.Equal(1, layout!.Version);
        return (client, dbPath, layout.Id);
    }

    [Fact]
    public async Task SecondSaveWithStaleVersion_IsRejectedWith409AndReadableMessage()
    {
        var (client, _, id) = await SetupAsync();

        // A 保存（版本 1 → 2）
        var first = await client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("A", 1));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(2, (await first.Content.ReadFromJsonAsync<StorageLayout>())!.Version);

        // B 仍基于版本 1 保存 → 必须 409，且带上"谁/什么时候/当前版本"
        var second = await client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("B", 1));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var body = await second.Content.ReadAsStringAsync();
        Assert.Contains("\"currentVersion\":2", body.Replace(" ", ""));
        Assert.Contains("\"yourVersion\":1", body.Replace(" ", ""));
        Assert.Contains("planner", body);
        Assert.Contains("已被", body);
        Assert.Contains("强制覆盖", body);
    }

    [Fact]
    public async Task SaveWithoutExpectedVersion_IsRejectedInsteadOfSilentlyOverwriting()
    {
        var (client, _, id) = await SetupAsync();

        var res = await client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("no-version", null));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("expectedVersion", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ForceOverwrite_SucceedsAndIsAudited()
    {
        var (client, dbPath, id) = await SetupAsync();
        await client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("A", 1));   // → 版本 2

        var forced = await client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("forced", 1, force: true));

        Assert.Equal(HttpStatusCode.OK, forced.StatusCode);
        var saved = await forced.Content.ReadFromJsonAsync<StorageLayout>();
        Assert.Equal(3, saved!.Version);
        Assert.Contains("forced", saved.LayoutJson);

        // 强制覆盖必须留痕（审计走后台 channel，轮询等它落库）
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        OperationLog? row = null;
        for (var i = 0; i < 120 && row is null; i++)
        {
            await using var db = new AppDbContext(opts);
            row = await db.OperationLogs.AsNoTracking()
                .Where(o => o.Action == "force-overwrite").OrderByDescending(o => o.Id).FirstOrDefaultAsync();
            if (row is null) await Task.Delay(250);
        }
        Assert.NotNull(row);
        Assert.Equal("planner", row!.UserName);
        Assert.Equal(id.ToString(), row.TargetId);
        Assert.Contains("discardedVersion", row.Data ?? "");
    }

    [Fact]
    public async Task TrulyConcurrentSaves_ExactlyOneWins()
    {
        var (client, _, id) = await SetupAsync();
        await client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("A", 1));   // → 版本 2

        // 两个请求同时基于版本 2 保存：乐观锁语义 = 一个 200、一个 409，绝不允许两个都成功
        var a = client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("parallel-A", 2));
        var b = client.PutAsJsonAsync($"/api/storage/layouts/{id}", SaveBody("parallel-B", 2));
        var responses = await Task.WhenAll(a, b);

        var codes = responses.Select(r => (int)r.StatusCode).OrderBy(c => c).ToArray();
        Assert.Equal(new[] { 200, 409 }, codes);
    }
}
