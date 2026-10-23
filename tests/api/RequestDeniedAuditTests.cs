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
/// 鉴权拒绝的可观测性（LOG-01 生产盲区修复）：
///  - 未登录访问需要鉴权的 API → **401 也必须落请求日志**（SystemLog category=http）；
///    这要求 RequestLogging 注册在 UseAuthentication/UseAuthorization 之前（短路请求才走得到）。
///  - 已登录成员访问 staff 端点 → 403 请求日志 + OperationLog action=denied 审计。
///  - 401 无已认证用户时只记请求日志，不写操作审计（匿名 401 不算安全事件）。
/// </summary>
public class RequestDeniedAuditTests : IClassFixture<WebApplicationFactory<Program>>
{
    // 精确路由（不是 "/api/admin/logs"，避免组根路由尾斜杠的匹配歧义）
    private const string StaffPath = "/api/admin/logs/stats";
    private readonly WebApplicationFactory<Program> _factory;

    public RequestDeniedAuditTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    private HttpClient CreateClient(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", "Data Source=" + dbPath);
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
        // 关闭去重：断言的是"这一条必须落"，不能让静态去重字典被其它测试的相同请求吞掉
        b.UseSetting("RequestLogging:DedupeWindowSeconds", "0");
        b.ConfigureTestServices(s => s.AddSingleton<IStartupFilter, FakeRemoteIpStartupFilter>());
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static DbContextOptions<AppDbContext> DbOpts(string dbPath)
        => new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=" + dbPath).Options;

    private static async Task<int> SeedMemberAsync(string dbPath)
    {
        await using var db = new AppDbContext(DbOpts(dbPath));
        var user = new User
        {
            Username = "member1",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
            Role = "member",
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static async Task<SystemLog?> WaitForHttpLogAsync(string dbPath, int status)
    {
        for (var i = 0; i < 120; i++)
        {
            await using var db = new AppDbContext(DbOpts(dbPath));
            var marker = "→ " + status; // 消息形如 "GET /api/admin/logs → 401 (5ms) [匿名]"
            var row = await db.SystemLogs.AsNoTracking()
                .Where(l => l.Category == "http" && l.Message.Contains(StaffPath) && l.Message.Contains(marker))
                .OrderByDescending(l => l.Id)
                .FirstOrDefaultAsync();
            if (row is not null) return row;
            await Task.Delay(250);
        }
        return null;
    }

    private static async Task<OperationLog?> WaitForDeniedAsync(string dbPath, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        do
        {
            await using var db = new AppDbContext(DbOpts(dbPath));
            var row = await db.OperationLogs.AsNoTracking()
                .Where(o => o.Action == "denied")
                .OrderByDescending(o => o.Id)
                .FirstOrDefaultAsync();
            if (row is not null) return row;
            await Task.Delay(250);
        } while (DateTime.UtcNow < deadline);
        return null;
    }

    private static async Task<string> DumpLogsAsync(string dbPath)
    {
        await using var db = new AppDbContext(DbOpts(dbPath));
        var sys = await db.SystemLogs.AsNoTracking().Select(l => l.Category + ":" + l.Message).ToListAsync();
        var ops = await db.OperationLogs.AsNoTracking().Select(o => o.Action + ":" + o.TargetId).ToListAsync();
        return "SystemLogs=[" + string.Join("; ", sys) + "] OperationLogs=[" + string.Join("; ", ops) + "]";
    }

    [Fact]
    public async Task Unauthenticated_401_StillWritesRequestLog_ButNoDeniedAudit()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), "tp-denied-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var client = CreateClient(dbPath);
            var res = await client.GetAsync(StaffPath);
            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);

            var log = await WaitForHttpLogAsync(dbPath, 401);
            Assert.True(log is not null, await DumpLogsAsync(dbPath));
            Assert.Equal("http", log!.Category);
            Assert.Contains("401", log.Message);
            Assert.Contains("\"status\":401", log.Detail ?? "");
            Assert.Contains("\"ip\":\"" + FakeRemoteIpStartupFilter.Ip + "\"", log.Detail ?? "");

            // 401 且无已认证用户：不得写 denied 操作审计
            Assert.Null(await WaitForDeniedAsync(dbPath, 4000));
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Member_403_WritesRequestLog_AndDeniedAudit()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), "tp-denied-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var client = CreateClient(dbPath);
            var memberId = await SeedMemberAsync(dbPath);

            var login = await client.PostAsJsonAsync("/api/auth/login",
                new { username = "member1", password = "pw123456" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);

            var res = await client.GetAsync(StaffPath);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);

            var log = await WaitForHttpLogAsync(dbPath, 403);
            Assert.True(log is not null, await DumpLogsAsync(dbPath));
            Assert.Contains("[member1]", log!.Message);

            var audit = await WaitForDeniedAsync(dbPath, 30000);
            Assert.True(audit is not null, await DumpLogsAsync(dbPath));
            Assert.Equal("denied", audit!.Action);
            Assert.Equal("http", audit.TargetType);
            Assert.Equal(StaffPath, audit.TargetId);
            Assert.Equal("member1", audit.UserName);
            Assert.Equal((int?)memberId, audit.UserId);
            Assert.Equal(FakeRemoteIpStartupFilter.Ip, audit.IpAddress);
            Assert.Contains("\"status\":403", audit.Data ?? "");
            Assert.Contains("\"method\":\"GET\"", audit.Data ?? "");
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
