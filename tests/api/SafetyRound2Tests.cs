using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>安全批：鼓包禁借、归还健康检查（异常转维修）、设备会话操作后撤销、弱认证标记。</summary>
public class SafetyRound2Tests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public SafetyRound2Tests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record BatteryResp(int Id, string Code, string Status, string? Health);
    private sealed record DeviceResp(int Id, string DeviceKey, string Secret);
    private sealed record SessionResp(string SessionToken, DateTime ExpiresAt);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-sr2-{Guid.NewGuid():N}.db");

    private HttpClient NewClient(string dbPath)
    {
        if (!File.Exists(dbPath)) File.WriteAllBytes(dbPath, Array.Empty<byte>());
        return _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            b.ConfigureLogging(lb => lb.ClearProviders());
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private async Task<string> LoginTokenAsync(HttpClient client, string dbPath, string username, string role)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User { Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"), Role = role });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }

    [Fact]
    public async Task UnsafeHealth_BorrowIsRejected()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var token = await LoginTokenAsync(client, dbPath, "sr2admin", "admin");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            // 鼓包电池在库也不许借
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var db = new AppDbContext(opts))
            {
                db.BatteryItems.Add(new BatteryItem { Code = "BAT-7001", Health = "鼓包", Status = "in_stock" });
                await db.SaveChangesAsync();
            }
            var item = await client.GetFromJsonAsync<BatteryResp>("/api/battery/by-code/BAT-7001");
            var borrow = await client.PostAsJsonAsync($"/api/battery/{item!.Id}/borrow", new { });
            Assert.Equal(HttpStatusCode.Conflict, borrow.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Return_AbnormalHealth_TransfersToRepair()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var token = await LoginTokenAsync(client, dbPath, "sr2admin2", "admin");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var created = await client.PostAsJsonAsync("/api/battery", new { code = "BAT-7002" });
            var item = (await created.Content.ReadFromJsonAsync<BatteryResp>())!;
            await client.PostAsJsonAsync($"/api/battery/{item.Id}/borrow", new { });

            // 归还声明鼓包 → 自动转维修
            var ret = await client.PostAsJsonAsync($"/api/battery/{item.Id}/return", new { health = "鼓包" });
            Assert.Equal(HttpStatusCode.OK, ret.StatusCode);

            var after = await client.GetFromJsonAsync<BatteryResp>($"/api/battery/{item.Id}");
            Assert.Equal("repair", after!.Status);
            Assert.Equal("鼓包", after.Health);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Return_NormalHealth_StaysInStock()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var token = await LoginTokenAsync(client, dbPath, "sr2admin3", "admin");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var created = await client.PostAsJsonAsync("/api/battery", new { code = "BAT-7003" });
            var item = (await created.Content.ReadFromJsonAsync<BatteryResp>())!;
            await client.PostAsJsonAsync($"/api/battery/{item.Id}/borrow", new { });
            var ret = await client.PostAsJsonAsync($"/api/battery/{item.Id}/return", new { health = "正常" });
            Assert.Equal(HttpStatusCode.OK, ret.StatusCode);

            var after = await client.GetFromJsonAsync<BatteryResp>($"/api/battery/{item.Id}");
            Assert.Equal("in_stock", after!.Status);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DeviceBorrow_RevokesSession_AfterOperation()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = NewClient(dbPath);
            var token = await LoginTokenAsync(admin, dbPath, "sr2admin4", "admin");
            admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            await admin.PostAsJsonAsync("/api/battery", new { code = "BAT-7004" });
            var devRes = await admin.PostAsJsonAsync("/api/admin/devices", new { name = "会话撤销测试", type = "test" });
            var dev = await devRes.Content.ReadFromJsonAsync<DeviceResp>();

            var devClient = NewClient(dbPath);
            devClient.DefaultRequestHeaders.Add("X-Device-Key", dev!.DeviceKey);
            devClient.DefaultRequestHeaders.Add("X-Device-Secret", dev.Secret);
            var login = await devClient.PostAsJsonAsync("/api/device/login", new { username = "sr2admin4", password = "pw123456" });
            var sess = (await login.Content.ReadFromJsonAsync<SessionResp>())!;
            devClient.DefaultRequestHeaders.Add("X-Device-Session", sess.SessionToken);

            // 借出成功后会话被撤销：再查电池应 401（一次认人一次操作）
            var borrow = await devClient.PostAsJsonAsync("/api/device/battery/BAT-7004/borrow", new { });
            Assert.Equal(HttpStatusCode.OK, borrow.StatusCode);

            var after = await devClient.GetAsync("/api/device/battery/BAT-7004");
            Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
