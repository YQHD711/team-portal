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

/// <summary>身份挂失：学号泄露后一键封禁账号（登录+设备认人同时失效），仅 admin 可挂失/解挂。</summary>
public class IdentityLossTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public IdentityLossTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record DeviceResp(int Id, string DeviceKey, string Secret);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-il-{Guid.NewGuid():N}.db");

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

    private async Task<string> SeedAndLoginAsync(HttpClient client, string dbPath, string username, string role, string? studentId = null)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User { Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"), Role = role, StudentId = studentId });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }

    [Fact]
    public async Task DisabledUser_CannotLogin()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await SeedAndLoginAsync(client, dbPath, "iladmin", "admin");
            await SeedAndLoginAsync(client, dbPath, "ilvictim", "member", "20240001");

            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            int victimId;
            await using (var db = new AppDbContext(opts))
                victimId = await db.Users.Where(u => u.Username == "ilvictim").Select(u => u.Id).FirstAsync();

            // admin 挂失
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
            var disable = await client.PutAsJsonAsync($"/api/admin/users/{victimId}", new { identityDisabled = true });
            Assert.Equal(HttpStatusCode.OK, disable.StatusCode);

            // 登录被拒（挂失是账号封禁 → 403，区别于密码错误 401）
            var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "ilvictim", password = "pw123456" });
            Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);

            // 解挂后恢复
            var enable = await client.PutAsJsonAsync($"/api/admin/users/{victimId}", new { identityDisabled = false });
            Assert.Equal(HttpStatusCode.OK, enable.StatusCode);
            var relogin = await client.PostAsJsonAsync("/api/auth/login", new { username = "ilvictim", password = "pw123456" });
            Assert.Equal(HttpStatusCode.OK, relogin.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DisabledUser_CannotLoginById()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await SeedAndLoginAsync(client, dbPath, "iladmin2", "admin");
            await SeedAndLoginAsync(client, dbPath, "ilvictim2", "member", "20240002");

            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            int victimId;
            await using (var db = new AppDbContext(opts))
                victimId = await db.Users.Where(u => u.Username == "ilvictim2").Select(u => u.Id).FirstAsync();

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
            var devRes = await client.PostAsJsonAsync("/api/admin/devices", new { name = "挂失测试", type = "test" });
            var dev = await devRes.Content.ReadFromJsonAsync<DeviceResp>();
            var devClient = NewClient(dbPath);
            devClient.DefaultRequestHeaders.Add("X-Device-Key", dev!.DeviceKey);
            devClient.DefaultRequestHeaders.Add("X-Device-Secret", dev.Secret);

            // 挂失后学号认人被拒
            await client.PutAsJsonAsync($"/api/admin/users/{victimId}", new { identityDisabled = true });
            var byId = await devClient.PostAsJsonAsync("/api/device/login-by-id", new { identifier = "20240002" });
            Assert.Equal(HttpStatusCode.Forbidden, byId.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Leader_CannotDisableIdentity()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await SeedAndLoginAsync(client, dbPath, "iladmin3", "admin");
            var leaderToken = await SeedAndLoginAsync(client, dbPath, "illeader", "部长");
            await SeedAndLoginAsync(client, dbPath, "ilvictim3", "member");

            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            int victimId;
            await using (var db = new AppDbContext(opts))
                victimId = await db.Users.Where(u => u.Username == "ilvictim3").Select(u => u.Id).FirstAsync();

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);
            var deny = await client.PutAsJsonAsync($"/api/admin/users/{victimId}", new { identityDisabled = true });
            Assert.Equal(HttpStatusCode.NotFound, deny.StatusCode); // false → 404「权限不足或用户不存在」

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
            var ok = await client.PutAsJsonAsync($"/api/admin/users/{victimId}", new { identityDisabled = true });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
