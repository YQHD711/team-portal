using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// POST /api/client-logs（LOG-01）：前端崩溃上报必须**匿名可用、始终 204**，
/// 并在 SystemLogs(category=client) 留一条可查记录；字段超长要截断，level 非法回退 warn。
/// 断言直接查 SystemLogs 表 —— 只看 204 测不出"日志到底落没落"。
/// </summary>
public class ClientLogEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public ClientLogEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private HttpClient CreateClient(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", "Data Source=" + dbPath);
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
        // 关掉请求日志去重，避免静态去重字典被其它测试的同一路径请求影响
        b.UseSetting("RequestLogging:DedupeWindowSeconds", "0");
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static DbContextOptions<AppDbContext> DbOpts(string dbPath)
        => new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=" + dbPath).Options;

    /// <summary>日志走后台 channel（最长约 3 秒一批），轮询等它落库；30 秒是并行跑宿主时的余量。</summary>
    private static async Task<SystemLog?> WaitForClientLogAsync(string dbPath)
    {
        for (var i = 0; i < 120; i++)
        {
            await using var db = new AppDbContext(DbOpts(dbPath));
            var row = await db.SystemLogs.AsNoTracking()
                .Where(l => l.Category == "client")
                .OrderByDescending(l => l.Id)
                .FirstOrDefaultAsync();
            if (row is not null) return row;
            await Task.Delay(250);
        }
        return null;
    }

    private static async Task<string> DumpLogsAsync(string dbPath)
    {
        await using var db = new AppDbContext(DbOpts(dbPath));
        var rows = await db.SystemLogs.AsNoTracking()
            .Select(l => l.Category + ":" + l.Level + ":" + l.Message).ToListAsync();
        return "SystemLogs=[" + string.Join("; ", rows) + "]";
    }

    [Fact]
    public async Task AnonymousPost_Returns204_AndWritesClientLog()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), "tp-client-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var client = CreateClient(dbPath);
            var res = await client.PostAsJsonAsync("/api/client-logs", new
            {
                level = "error",
                message = "TypeError: x is not a function",
                stack = "at app.js:1:2",
                url = "https://8.137.161.160/tools",
                // 前端可能多带的未知字段：服务端忽略，不影响 204
                type = "unhandledrejection",
            });

            Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

            var log = await WaitForClientLogAsync(dbPath);
            Assert.True(log is not null, await DumpLogsAsync(dbPath));
            Assert.Equal("error", log!.Level);
            Assert.Equal("client", log.Category);
            Assert.Contains("x is not a function", log.Message);
            Assert.Contains("app.js:1:2", log.Detail ?? "");
            Assert.Contains("https://8.137.161.160/tools", log.Detail ?? "");
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task InvalidLevel_FallsBackToWarn_AndLongFieldsAreTruncated()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), "tp-client-" + Guid.NewGuid().ToString("N") + ".db");
        try
        {
            var client = CreateClient(dbPath);
            var res = await client.PostAsJsonAsync("/api/client-logs", new
            {
                level = "verbose", // 非法级别 → warn，不返回 400
                message = new string('m', 800),
                stack = new string('s', 3000),
                url = new string('u', 800),
            });

            Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
            var log = await WaitForClientLogAsync(dbPath);
            Assert.True(log is not null, await DumpLogsAsync(dbPath));
            Assert.Equal("warn", log!.Level);
            Assert.Equal(500, log.Message.Length);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
