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
/// 把直连对端 IP 伪造成指定值（模拟"请求来自代理容器"或"来自任意客户端"）。
/// 必须注册为 IStartupFilter：这样它跑在 Program 管线**最前面**，UseForwardedHeaders 才能看到这个对端。
/// </summary>
internal sealed class PeerIpStartupFilter : IStartupFilter
{
    /// <summary>当前对端 IP（同一测试类内串行执行，不会串台）。</summary>
    public static string Peer = "203.0.113.7";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (ctx, nxt) =>
        {
            ctx.Connection.RemoteIpAddress = IPAddress.Parse(Peer);
            await nxt();
        });
        next(app);
    };
}

/// <summary>
/// 来源 IP 的两面性（审计 #22）：既要记到**真实客户端 IP**，又不能让伪造的 X-Forwarded-For 生效。
///
/// 三条断言（缺一条这道防线就是坏的）：
///  1. 对端是**可信代理** → 采用 XFF 里的客户端 IP（否则线上永远只记代理地址 10.255.1.x）
///  2. 对端**不是**可信代理 → 完全忽略 XFF，记真实对端（否则任何私网来源都能冒充别人）
///  3. 可信代理 + 多段 XFF（客户端在前面塞了伪造值）→ 取**最右**那段（= 代理自己追加的真实客户端）
/// </summary>
public class ClientIpTrustTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string TrustedProxy = "203.0.113.7";     // 模拟 frontend/nginx 容器
    private const string UntrustedPeer = "198.51.100.7";   // 模拟"绕过代理直连"的来源
    private const string RealClient = "198.51.100.25";
    private const string ForgedClient = "1.2.3.4";

    private readonly WebApplicationFactory<Program> _factory;

    public ClientIpTrustTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private async Task<(HttpClient Client, string DbPath)> SetupAsync()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-clientip-{Guid.NewGuid():N}.db");
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            // 只信任这一个代理地址（与线上 compose 的 KnownProxies 口径一致）
            b.UseSetting("ForwardedHeaders:KnownProxies", TrustedProxy);
            b.UseSetting("ForwardedHeaders:ForwardLimit", "1");
            b.ConfigureTestServices(s => s.AddSingleton<IStartupFilter, PeerIpStartupFilter>());
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = "ip-probe",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = "member",
            });
            await seed.SaveChangesAsync();
        }
        return (client, dbPath);
    }

    /// <summary>登录会写一条 login 审计（带 ClientIp）；轮询等后台批量落库。</summary>
    private async Task<OperationLog?> LoginAndReadLogAsync(HttpClient client, string dbPath, string? forwardedFor)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(new { username = "ip-probe", password = "pw123456" })
        };
        if (forwardedFor is not null) req.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
        var res = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        for (var i = 0; i < 120; i++)
        {
            await using var db = new AppDbContext(opts);
            var row = await db.OperationLogs.AsNoTracking()
                .Where(o => o.Action == "login").OrderByDescending(o => o.Id).FirstOrDefaultAsync();
            if (row is not null) return row;
            await Task.Delay(250);   // 审计走后台 channel（最长 3 秒一批）
        }
        return null;
    }

    [Fact]
    public async Task TrustedProxy_RealClientIpFromXffIsRecorded()
    {
        PeerIpStartupFilter.Peer = TrustedProxy;
        var (client, dbPath) = await SetupAsync();

        var log = await LoginAndReadLogAsync(client, dbPath, RealClient);

        Assert.NotNull(log);
        Assert.Equal(RealClient, log!.IpAddress);
    }

    [Fact]
    public async Task UntrustedPeer_ForgedXffIsIgnored()
    {
        PeerIpStartupFilter.Peer = UntrustedPeer;
        var (client, dbPath) = await SetupAsync();

        var log = await LoginAndReadLogAsync(client, dbPath, ForgedClient);

        Assert.NotNull(log);
        // 关键：伪造无效 —— 记的是真实对端，而不是 1.2.3.4
        Assert.Equal(UntrustedPeer, log!.IpAddress);
        Assert.NotEqual(ForgedClient, log.IpAddress);
    }

    [Fact]
    public async Task TrustedProxy_MultiHopChain_TakesRightmostEntry()
    {
        PeerIpStartupFilter.Peer = TrustedProxy;
        var (client, dbPath) = await SetupAsync();

        // 攻击者在最左边塞了伪造值；可信代理把自己看到的真实客户端追加到最右
        var log = await LoginAndReadLogAsync(client, dbPath, $"{ForgedClient}, {RealClient}");

        Assert.NotNull(log);
        Assert.Equal(RealClient, log!.IpAddress);
        Assert.NotEqual(ForgedClient, log.IpAddress);
    }
}
