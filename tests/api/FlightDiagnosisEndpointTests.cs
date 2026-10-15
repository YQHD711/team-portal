using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 诊断历史端点：POST/GET 契约 + 权限（普通队员只能看自己的，admin 看全部）。
/// 真实宿主（新库由 EF 迁移建表）+ 真实登录，不 mock。
/// </summary>
public class FlightDiagnosisEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public FlightDiagnosisEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record CreatedResp(int Id);
    private sealed class Item
    {
        public int Id { get; set; }
        public string FileName { get; set; } = "";
        public string? CreatedBy { get; set; }
        public int Critical { get; set; }
        public long SkippedBytes { get; set; }
        public int DecodedTypes { get; set; }
        public int TotalTypes { get; set; }
        public int ParseMs { get; set; }
        public int AnalyzeMs { get; set; }
        public List<string> Warnings { get; set; } = new();
    }
    private sealed class ListResp
    {
        public int Total { get; set; }
        public List<Item> Items { get; set; } = new();
    }

    private HttpClient NewClient(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static string NewDbPath() => Path.Combine(Path.GetTempPath(), $"tp-diag-{Guid.NewGuid():N}.db");

    private async Task<HttpClient> LoginAsync(string dbPath, string username, string role)
    {
        var client = NewClient(dbPath);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
            });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object Body(string fileName) => new
    {
        fileName,
        sizeBytes = 9_800_000L,
        records = 229_590L,
        skippedBytes = 12L,
        durationSec = 362.1,
        vehicle = "ArduCopter",
        vehicleKind = "copter",
        firmwareVersion = "4.6.2",
        versionNumeric = 40602,
        // ⚠️ 故意用**小数**：前端 performance.now() 差值就是这个形状（线上实测 69.89999999990687）。
        // 曾经 DTO 声明成 int → System.Text.Json 绑定失败 → 框架级 400（且服务端校验根本没被调用）。
        // 这条用例就是那个线上事故的回归守卫。
        parseMs = 69.89999999990687,
        analyzeMs = 2.1000000000931323,
        decodedTypes = 81,
        totalTypes = 81,
        critical = 1,
        warning = 2,
        passed = 3,
        unknown = 1,
        warnings = new[] { "跳过了 12 个无法识别的字节" },
        findings = new[]
        {
            new { ruleId = "vibration_level", title = "振动超标（IMU0）", severity = "critical", status = "fired", axis = (string?)null },
        },
    };

    [Fact]
    public async Task PostThenListAndDetail_RoundTrip()
    {
        var dbPath = NewDbPath();
        var member = await LoginAsync(dbPath, "alice", "member");

        var post = await member.PostAsJsonAsync("/api/flight-diagnoses", Body("quad.bin"));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);
        var created = await post.Content.ReadFromJsonAsync<CreatedResp>();
        Assert.True(created!.Id > 0);

        var list = await member.GetFromJsonAsync<ListResp>("/api/flight-diagnoses");
        Assert.Equal(1, list!.Total);
        Assert.Equal("alice", list.Items[0].CreatedBy);
        Assert.Equal(12, list.Items[0].SkippedBytes);
        Assert.Equal(81, list.Items[0].DecodedTypes);
        Assert.Single(list.Items[0].Warnings);

        var detail = await member.GetFromJsonAsync<Item>($"/api/flight-diagnoses/{created.Id}");
        Assert.Equal("quad.bin", detail!.FileName);
        Assert.Equal(1, detail.Critical);
        // 小数毫秒被接受，并按四舍五入落库（69.9 → 70、2.1 → 2）
        Assert.Equal(70, detail.ParseMs);
        Assert.Equal(2, detail.AnalyzeMs);
    }

    [Fact]
    public async Task Post_RejectsInvalidBodyAndAnonymous()
    {
        var dbPath = NewDbPath();
        var member = await LoginAsync(dbPath, "alice", "member");

        var bad = await member.PostAsJsonAsync("/api/flight-diagnoses", Body("   "));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var anonymous = NewClient(NewDbPath());
        var noAuth = await anonymous.PostAsJsonAsync("/api/flight-diagnoses", Body("a.bin"));
        Assert.Equal(HttpStatusCode.Unauthorized, noAuth.StatusCode);
    }

    [Fact]
    public async Task List_MemberSeesOnlyOwn_AdminSeesAll()
    {
        var dbPath = NewDbPath();
        var alice = await LoginAsync(dbPath, "alice", "member");
        var bob = await LoginAsync(dbPath, "bob", "member");
        var admin = await LoginAsync(dbPath, "root", "admin");

        Assert.Equal(HttpStatusCode.OK, (await alice.PostAsJsonAsync("/api/flight-diagnoses", Body("alice.bin"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await bob.PostAsJsonAsync("/api/flight-diagnoses", Body("bob.bin"))).StatusCode);

        var aliceList = await alice.GetFromJsonAsync<ListResp>("/api/flight-diagnoses");
        Assert.Equal(1, aliceList!.Total);
        Assert.Equal("alice.bin", aliceList.Items[0].FileName);

        var adminList = await admin.GetFromJsonAsync<ListResp>("/api/flight-diagnoses");
        Assert.Equal(2, adminList!.Total);

        // 按文件名筛选（同一日志回看/对比用）
        var filtered = await admin.GetFromJsonAsync<ListResp>("/api/flight-diagnoses?fileName=bob.bin");
        Assert.Equal(1, filtered!.Total);
    }

    [Fact]
    public async Task Detail_CrossUserForbidden_MissingNotFound()
    {
        var dbPath = NewDbPath();
        var alice = await LoginAsync(dbPath, "alice", "member");
        var bob = await LoginAsync(dbPath, "bob", "member");
        var admin = await LoginAsync(dbPath, "root", "admin");

        var created = await (await alice.PostAsJsonAsync("/api/flight-diagnoses", Body("alice.bin")))
            .Content.ReadFromJsonAsync<CreatedResp>();

        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.GetAsync($"/api/flight-diagnoses/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await admin.GetAsync("/api/flight-diagnoses/999999")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await admin.GetAsync($"/api/flight-diagnoses/{created.Id}")).StatusCode);
    }
}
