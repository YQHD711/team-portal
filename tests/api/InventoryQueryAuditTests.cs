using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// TestServer 默认不给 RemoteIpAddress，于是 LogService.ClientIp 恒为 null，
/// "来源 IP 有没有落进审计"就断言不了。这个过滤器在应用管线最前面塞一个固定 IP。
/// </summary>
internal sealed class FakeRemoteIpStartupFilter : IStartupFilter
{
    public const string Ip = "203.0.113.7";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (ctx, nxt) =>
        {
            ctx.Connection.RemoteIpAddress = IPAddress.Parse(Ip);
            await nxt();
        });
        next(app);
    };
}

/// <summary>
/// 扫码/手输编码查询（GET /api/inventory/by-code/{code}）必须留审计。
///
/// 要点：**命中与未命中都要落一条，且两条可区分**。未命中那条尤其不能漏 ——
/// 反复查不到编码正是"有人在拿编码探测库里有什么"的信号，只记命中等于把这类行为丢掉。
///
/// 断言直接看到 OperationLogs 表本身（而不是只看 200/404）：接口通了但审计没写，
/// 只看状态码是测不出来的。
/// </summary>
public class InventoryQueryAuditTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Code = "PW-PROP-9450-2026-0001";
    private const string MissCode = "NO-SUCH-CODE";

    private readonly WebApplicationFactory<Program> _factory;

    public InventoryQueryAuditTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    private async Task<(HttpClient Client, int ItemId)> SetupAsync(string dbPath)
    {
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            b.ConfigureTestServices(s => s.AddSingleton<IStartupFilter, FakeRemoteIpStartupFilter>());
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        int itemId;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = "scanner",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = "member",
            });
            var item = new InventoryItem
            {
                Name = "桨叶", Category = "动力系统", Quantity = 5, Grade = "B", UnitPrice = 45,
                Code = Code, LocationCode = "201-A-3-05",
            };
            seed.InventoryItems.Add(item);
            // 必须先保存：拿未落库的 Id 去引用会得到 0（本仓库踩过三次）
            await seed.SaveChangesAsync();
            itemId = item.Id;
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "scanner", password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, itemId);
    }

    /// <summary>Audit 走后台 channel 批量落库（最长 3 秒一批），所以这里轮询等它写进表。
    /// 窗口给到 30 秒是余量：整仓测试并行跑时宿主多、CPU 挤，flush 可能被拖慢；
    /// 一旦真没写（落库失败/批次被丢），也该由这里的断言暴露，而不是让测试挂太久。</summary>
    private static async Task<OperationLog?> WaitForQueryLogAsync(string dbPath)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        for (var i = 0; i < 120; i++)
        {
            await using var db = new AppDbContext(opts);
            var row = await db.OperationLogs.AsNoTracking()
                .Where(o => o.Action == "query")
                .OrderByDescending(o => o.Id)
                .FirstOrDefaultAsync();
            if (row is not null) return row;
            await Task.Delay(250); // 共等约 30 秒
        }
        return null;
    }

    /// <summary>等不到审计时，把两张日志表的状态打出来，好区分"没写"和"写了但慢"。</summary>
    private static async Task<string> DumpLogTablesAsync(string dbPath)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        var ops = await db.OperationLogs.AsNoTracking().Select(o => new { o.Action, o.TargetId }).ToListAsync();
        var sys = await db.SystemLogs.AsNoTracking().Select(l => new { l.Category, l.Message }).ToListAsync();
        return $"OperationLogs=[{string.Join("; ", ops.Select(o => $"{o.Action}/{o.TargetId}"))}] " +
               $"SystemLogs=[{string.Join("; ", sys.Select(l => $"{l.Category}:{l.Message}"))}]";
    }

    [Fact]
    public async Task Hit_WritesAuditCarryingActorCodeResultAndIp()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-query-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath);

            var res = await client.GetAsync($"/api/inventory/by-code/{Code}");
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);

            var log = await WaitForQueryLogAsync(dbPath);
            Assert.True(log is not null, await DumpLogTablesAsync(dbPath));
            Assert.Equal("query", log!.Action);
            Assert.Equal("scanner", log.UserName);
            // 时间（由 Audit 自动落）：必须落在本次查询附近
            Assert.True(log.CreatedAt > DateTime.UtcNow.AddMinutes(-2), $"时间戳不对: {log.CreatedAt:O}");
            Assert.Equal("item", log.TargetType);
            Assert.Equal(itemId.ToString(), log.TargetId);
            Assert.Equal(FakeRemoteIpStartupFilter.Ip, log.IpAddress);
            var data = log.Data ?? "";
            Assert.Contains("\"result\":\"hit\"", data);
            Assert.Contains($"\"code\":\"{Code}\"", data);
            Assert.Contains($"\"itemId\":{itemId}", data);
            // 只放必要字段：不把整个物料对象（数量/单价/照片…）塞进审计
            Assert.DoesNotContain("quantity", data);
            Assert.DoesNotContain("unitPrice", data);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Miss_AlsoWritesAudit_AndIsDistinguishableFromHit()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-query-{Guid.NewGuid():N}.db");
        try
        {
            var (client, _) = await SetupAsync(dbPath);

            var res = await client.GetAsync($"/api/inventory/by-code/{MissCode}");
            Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);

            var log = await WaitForQueryLogAsync(dbPath);
            Assert.True(log is not null, await DumpLogTablesAsync(dbPath));
            Assert.Equal("query", log!.Action);
            Assert.Equal("scanner", log.UserName);
            Assert.Equal("item", log.TargetType);
            // 与命中区分开：未命中没有物料 id 可挂，targetId 落 "miss"
            Assert.Equal("miss", log.TargetId);
            Assert.Equal(FakeRemoteIpStartupFilter.Ip, log.IpAddress);
            var data = log.Data ?? "";
            Assert.Contains("\"result\":\"miss\"", data);
            Assert.Contains(MissCode, data);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
