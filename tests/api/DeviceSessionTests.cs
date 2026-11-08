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

/// <summary>
/// 设备内用户会话：设备凭据 + 设备上登录用户 → 借还，不走用户 JWT。
/// 覆盖登录、错误密码、会话缺失、登出、跨设备隔离、会话过期。
/// </summary>
public class DeviceSessionTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public DeviceSessionTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record DeviceResp(int Id, string DeviceKey, string Secret);
    private sealed record SessionResp(string SessionToken, DateTime ExpiresAt, JsonUser User);
    private sealed record JsonUser(int Id, string Username, string Role);
    private sealed record BorrowResp(int LoanId, int BatteryId, string Code, int BorrowerId);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-ds-{Guid.NewGuid():N}.db");

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

    private static async Task SeedUserAsync(string dbPath, string username, string password, string role)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        var u = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = role,
        };
        db.Users.Add(u);
        await db.SaveChangesAsync();
    }

    private static async Task SeedBatteryAsync(string dbPath, string code)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        db.BatteryItems.Add(new BatteryItem { Code = code, Model = "6S", Status = "in_stock" });
        await db.SaveChangesAsync();
    }

    /// <summary>启动 host（触发建表）→ seed 管理员 → 登录拿 JWT。</summary>
    private async Task<HttpClient> AdminClientAsync(string dbPath)
    {
        var client = NewClient(dbPath);
        await SeedUserAsync(dbPath, "dsadmin", "pw123456", "admin");
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "dsadmin", password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<DeviceResp> CreateDeviceAsync(HttpClient admin, string name)
    {
        var res = await admin.PostAsJsonAsync("/api/admin/devices", new { name, type = "test" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<DeviceResp>())!;
    }

    private static void UseDevice(HttpClient client, string key, string secret)
    {
        client.DefaultRequestHeaders.Remove("X-Device-Key");
        client.DefaultRequestHeaders.Remove("X-Device-Secret");
        client.DefaultRequestHeaders.Add("X-Device-Key", key);
        client.DefaultRequestHeaders.Add("X-Device-Secret", secret);
    }

    private static void UseSession(HttpClient client, string sessionToken)
    {
        client.DefaultRequestHeaders.Remove("X-Device-Session");
        client.DefaultRequestHeaders.Add("X-Device-Session", sessionToken);
    }

    [Fact]
    public async Task DeviceLogin_ThenBorrowAndReturn_WithoutUserJwt()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await AdminClientAsync(dbPath);
            await SeedBatteryAsync(dbPath, "BAT-9001");
            var device = await CreateDeviceAsync(admin, "柜边扫码台");

            var client = NewClient(dbPath);
            UseDevice(client, device.DeviceKey, device.Secret);

            var login = await client.PostAsJsonAsync("/api/device/login",
                new { username = "dsadmin", password = "pw123456" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var session = (await login.Content.ReadFromJsonAsync<SessionResp>())!;
            Assert.False(string.IsNullOrWhiteSpace(session.SessionToken));
            Assert.Equal("dsadmin", session.User.Username);

            UseSession(client, session.SessionToken);

            var q = await client.GetAsync("/api/device/battery/BAT-9001");
            Assert.Equal(HttpStatusCode.OK, q.StatusCode);

            var borrow = await client.PostAsJsonAsync("/api/device/battery/BAT-9001/borrow", new { });
            Assert.Equal(HttpStatusCode.OK, borrow.StatusCode);
            var loan = (await borrow.Content.ReadFromJsonAsync<BorrowResp>())!;
            Assert.Equal("BAT-9001", loan.Code);

            var again = await client.PostAsJsonAsync("/api/device/battery/BAT-9001/borrow", new { });
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);

            var mine = await client.GetAsync("/api/device/battery/mine");
            Assert.Equal(HttpStatusCode.OK, mine.StatusCode);

            var ret = await client.PostAsJsonAsync("/api/device/battery/BAT-9001/return", new { });
            Assert.Equal(HttpStatusCode.OK, ret.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Borrow_WithoutSession_Returns401()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await AdminClientAsync(dbPath);
            await SeedBatteryAsync(dbPath, "BAT-9002");
            var device = await CreateDeviceAsync(admin, "未登录设备");

            var client = NewClient(dbPath);
            UseDevice(client, device.DeviceKey, device.Secret);

            var borrow = await client.PostAsJsonAsync("/api/device/battery/BAT-9002/borrow", new { });
            Assert.Equal(HttpStatusCode.Unauthorized, borrow.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task WrongPassword_Returns401()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await AdminClientAsync(dbPath);
            var device = await CreateDeviceAsync(admin, "错误密码测试");

            var client = NewClient(dbPath);
            UseDevice(client, device.DeviceKey, device.Secret);
            var login = await client.PostAsJsonAsync("/api/device/login",
                new { username = "dsadmin", password = "wrong" });
            Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Logout_RevokesSession()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await AdminClientAsync(dbPath);
            await SeedBatteryAsync(dbPath, "BAT-9003");
            var device = await CreateDeviceAsync(admin, "登出测试");

            var client = NewClient(dbPath);
            UseDevice(client, device.DeviceKey, device.Secret);
            var login = await client.PostAsJsonAsync("/api/device/login",
                new { username = "dsadmin", password = "pw123456" });
            var session = (await login.Content.ReadFromJsonAsync<SessionResp>())!;
            UseSession(client, session.SessionToken);

            var logout = await client.PostAsync("/api/device/logout", null);
            Assert.Equal(HttpStatusCode.OK, logout.StatusCode);

            var borrow = await client.PostAsJsonAsync("/api/device/battery/BAT-9003/borrow", new { });
            Assert.Equal(HttpStatusCode.Unauthorized, borrow.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Session_IsBoundToItsOwnDevice()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await AdminClientAsync(dbPath);
            await SeedBatteryAsync(dbPath, "BAT-9004");
            var devA = await CreateDeviceAsync(admin, "设备A");
            var devB = await CreateDeviceAsync(admin, "设备B");

            var clientA = NewClient(dbPath);
            UseDevice(clientA, devA.DeviceKey, devA.Secret);
            var login = await clientA.PostAsJsonAsync("/api/device/login",
                new { username = "dsadmin", password = "pw123456" });
            var session = (await login.Content.ReadFromJsonAsync<SessionResp>())!;

            var clientB = NewClient(dbPath);
            UseDevice(clientB, devB.DeviceKey, devB.Secret);
            UseSession(clientB, session.SessionToken);
            var borrow = await clientB.PostAsJsonAsync("/api/device/battery/BAT-9004/borrow", new { });
            Assert.Equal(HttpStatusCode.Unauthorized, borrow.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task ExpiredSession_Returns401()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await AdminClientAsync(dbPath);
            await SeedBatteryAsync(dbPath, "BAT-9005");
            var device = await CreateDeviceAsync(admin, "过期测试");

            var client = NewClient(dbPath);
            UseDevice(client, device.DeviceKey, device.Secret);
            var login = await client.PostAsJsonAsync("/api/device/login",
                new { username = "dsadmin", password = "pw123456" });
            var session = (await login.Content.ReadFromJsonAsync<SessionResp>())!;

            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var db = new AppDbContext(opts))
            {
                var row = await db.DeviceSessions.FirstAsync();
                row.ExpiresAt = DateTime.UtcNow.AddHours(-1);
                await db.SaveChangesAsync();
            }

            UseSession(client, session.SessionToken);
            var borrow = await client.PostAsJsonAsync("/api/device/battery/BAT-9005/borrow", new { });
            Assert.Equal(HttpStatusCode.Unauthorized, borrow.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
