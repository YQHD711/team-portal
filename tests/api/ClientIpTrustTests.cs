using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 来源 IP 的两面性（审计 #22）：既要记到**真实客户端 IP**，又不能让伪造的 X-Forwarded-For 生效。
///
/// 三条断言（缺一条这道防线就是坏的）：
///  1. 对端是**可信代理** → 采用 XFF 里的客户端 IP（否则线上永远只记代理地址 10.255.1.x）
///  2. 对端**不是**可信代理 → 完全忽略 XFF，记真实对端（否则任何来源都能冒充别人）
///  3. 可信代理 + 多段 XFF（客户端在前面塞了伪造值）→ 取**最右**那段（= 代理自己追加的真实客户端）
///
/// 实现口径：TestServer 的对端恒为 127.0.0.1，所以"可信/不可信"直接用 `KnownProxies` 表达
/// （可信：填 127.0.0.1；不可信：填别的地址）——**不需要伪造对端的 startup filter**，
/// 那种写法在并行跑全量测试时会被 WebApplicationFactory 的 host 复用弄丢（实测把对端退回 127.0.0.1）。
/// 另外这里**不调登录接口**（登录限流 5 次/60 秒/IP，会让并行测试互相打成 429），直接签发 token。
/// </summary>
public class ClientIpTrustTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public ClientIpTrustTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private const string Loopback = "127.0.0.1";        // TestServer 的直连对端
    private const string OtherProxy = "203.0.113.7";    // 不是对端 → 不可信
    private const string RealClient = "198.51.100.25";
    private const string ForgedClient = "1.2.3.4";
    private const string Code = "CC-IP-PROBE-0001";

    private async Task<(HttpClient Client, string DbPath)> SetupAsync(string knownProxies)
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-clientip-{Guid.NewGuid():N}.db");
        var factory = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", TestToken.JwtKey);
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            b.UseSetting("ForwardedHeaders:KnownProxies", knownProxies);
            b.UseSetting("ForwardedHeaders:ForwardLimit", "1");
        });
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Database.Migrate();
            seed.Users.Add(new User { Id = 1, Username = "ip-probe", PasswordHash = "x", Role = "admin" });
            seed.InventoryItems.Add(new InventoryItem
            {
                Name = "IP 探针物料", Category = "测试", Quantity = 1, Grade = "B", Code = Code,
            });
            await seed.SaveChangesAsync();
        }
        client.DefaultRequestHeaders.Authorization = new("Bearer", TestToken.Make(1, "ip-probe", "admin"));
        return (client, dbPath);
    }

    /// <summary>查询接口会写一条 query 审计（含 ClientIp）；轮询等后台 channel 落库。</summary>
    private static async Task<OperationLog?> QueryAndReadLogAsync(HttpClient client, string dbPath, string? forwardedFor)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"/api/inventory/by-code/{Code}");
        if (forwardedFor is not null) req.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
        var res = await client.SendAsync(req);
        Assert.NotEqual(HttpStatusCode.Unauthorized, res.StatusCode);   // token 必须有效

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        for (var i = 0; i < 120; i++)
        {
            await using var db = new AppDbContext(opts);
            var row = await db.OperationLogs.AsNoTracking()
                .Where(o => o.Action == "query").OrderByDescending(o => o.Id).FirstOrDefaultAsync();
            if (row is not null) return row;
            await Task.Delay(250);
        }
        return null;
    }

    [Fact]
    public async Task TrustedProxy_RealClientIpFromXffIsRecorded()
    {
        var (client, dbPath) = await SetupAsync(Loopback);

        var log = await QueryAndReadLogAsync(client, dbPath, RealClient);

        Assert.NotNull(log);
        Assert.Equal(RealClient, log!.IpAddress);
    }

    [Fact]
    public async Task UntrustedPeer_ForgedXffIsIgnored()
    {
        // 对端是 127.0.0.1，但 KnownProxies 里只有别的地址 → 这个对端不可信，XFF 必须被忽略
        var (client, dbPath) = await SetupAsync(OtherProxy);

        var log = await QueryAndReadLogAsync(client, dbPath, ForgedClient);

        Assert.NotNull(log);
        Assert.Equal(Loopback, log!.IpAddress);
        Assert.NotEqual(ForgedClient, log.IpAddress);
    }

    [Fact]
    public async Task TrustedProxy_MultiHopChain_TakesRightmostEntry()
    {
        var (client, dbPath) = await SetupAsync(Loopback);

        // 攻击者在最左边塞了伪造值；可信代理把自己看到的真实客户端追加到最右
        var log = await QueryAndReadLogAsync(client, dbPath, $"{ForgedClient}, {RealClient}");

        Assert.NotNull(log);
        Assert.Equal(RealClient, log!.IpAddress);
        Assert.NotEqual(ForgedClient, log.IpAddress);
    }
}
