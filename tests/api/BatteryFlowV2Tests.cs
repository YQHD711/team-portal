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
/// 电池流程 v2：显示姓名自改、设备免密认人（身份码/学号）、电池在库数同步物料表。
/// </summary>
public class BatteryFlowV2Tests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public BatteryFlowV2Tests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record MeResp(int Id, string Username, string? DisplayName);
    private sealed record SessionResp(string SessionToken, DateTime ExpiresAt, SessionUser User);
    private sealed record SessionUser(int Id, string Username, string? DisplayName, string Role);
    private sealed record BatteryResp(int Id, string Code, string Status);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-v2-{Guid.NewGuid():N}.db");

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

    private async Task<string> LoginTokenAsync(HttpClient client, string dbPath, string username, string role,
        string? slug = null)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
                Slug = slug,
            });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }

    [Fact]
    public async Task DisplayName_SelfUpdate_ReflectsInMe()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var token = await LoginTokenAsync(client, dbPath, "v2name", "member");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var put = await client.PutAsJsonAsync("/api/profile/display-name", new { displayName = "张三" });
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);

            var me = await client.GetFromJsonAsync<MeResp>("/api/auth/me");
            Assert.Equal("张三", me!.DisplayName);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DisplayName_RejectsOversize()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var token = await LoginTokenAsync(client, dbPath, "v2name2", "member");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var put = await client.PutAsJsonAsync("/api/profile/display-name", new { displayName = new string('长', 100) });
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task LoginById_WithSlug_CreatesSession()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = NewClient(dbPath);
            var adminToken = await LoginTokenAsync(admin, dbPath, "v2admin", "admin", "u_admin_slug");
            admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

            var devRes = await admin.PostAsJsonAsync("/api/admin/devices", new { name = "认人测试设备", type = "test" });
            Assert.Equal(HttpStatusCode.Created, devRes.StatusCode);
            var dev = await devRes.Content.ReadFromJsonAsync<Dictionary<string, object>>();
            var dh = new Dictionary<string, string>
            {
                ["X-Device-Key"] = dev!["deviceKey"].ToString()!,
                ["X-Device-Secret"] = dev!["secret"].ToString()!,
            };

            // 身份码内容（完整短链）→ 识别 slug
            var login = await admin.PostAsJsonAsync("/api/device/login-by-id",
                new { identifier = "https://team.example.com/u/u_admin_slug" });
            Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode); // 没带设备凭据 → 401

            var devClient = NewClient(dbPath);
            foreach (var kv in dh) devClient.DefaultRequestHeaders.Add(kv.Key, kv.Value);
            var login2 = await devClient.PostAsJsonAsync("/api/device/login-by-id",
                new { identifier = "https://team.example.com/u/u_admin_slug" });
            Assert.Equal(HttpStatusCode.OK, login2.StatusCode);
            var session = await login2.Content.ReadFromJsonAsync<SessionResp>();
            Assert.Equal("v2admin", session!.User.Username);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task LoginById_WithUsername_Fallback()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = NewClient(dbPath);
            var adminToken = await LoginTokenAsync(admin, dbPath, "v2admin2", "admin");
            admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

            var devRes = await admin.PostAsJsonAsync("/api/admin/devices", new { name = "学号认人", type = "test" });
            var dev = await devRes.Content.ReadFromJsonAsync<Dictionary<string, object>>();
            var devClient = NewClient(dbPath);
            devClient.DefaultRequestHeaders.Add("X-Device-Key", dev!["deviceKey"].ToString()!);
            devClient.DefaultRequestHeaders.Add("X-Device-Secret", dev!["secret"].ToString()!);

            // 输入学号/用户名兜底
            var login = await devClient.PostAsJsonAsync("/api/device/login-by-id", new { identifier = "v2admin2" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);

            // 不存在的身份 → 404
            var miss = await devClient.PostAsJsonAsync("/api/device/login-by-id", new { identifier = "nobody_xyz" });
            Assert.Equal(HttpStatusCode.NotFound, miss.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task InventoryCount_SyncsOnBorrowAndReturn()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var token = await LoginTokenAsync(client, dbPath, "v2sync", "admin");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            // 配置物料同步关联条目 + 建汇总物料
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var seed = new AppDbContext(opts))
            {
                seed.SystemSettings.Add(new SystemSetting { Key = "Battery:InventoryItemCode", Value = "BAT-SUMMARY" });
                seed.InventoryItems.Add(new InventoryItem
                {
                    Name = "电池电源汇总", Category = "电池电源", Quantity = 0, Code = "BAT-SUMMARY",
                });
                await seed.SaveChangesAsync();
            }

            // 建 2 块电池 → 在库数应为 2
            var b1 = await client.PostAsJsonAsync("/api/battery", new { code = "BAT-9001" });
            var b2 = await client.PostAsJsonAsync("/api/battery", new { code = "BAT-9002" });
            Assert.Equal(HttpStatusCode.Created, b1.StatusCode);
            Assert.Equal(HttpStatusCode.Created, b2.StatusCode);

            await using (var check = new AppDbContext(opts))
            {
                var summary = await check.InventoryItems.FirstAsync(i => i.Code == "BAT-SUMMARY");
                Assert.Equal(2, summary.Quantity);
            }

            // 借出一块 → 在库数 1
            var id1 = (await b1.Content.ReadFromJsonAsync<BatteryResp>())!.Id;
            Assert.Equal(HttpStatusCode.OK,
                (await client.PostAsJsonAsync($"/api/battery/{id1}/borrow", new { })).StatusCode);
            await using (var check = new AppDbContext(opts))
            {
                var summary = await check.InventoryItems.FirstAsync(i => i.Code == "BAT-SUMMARY");
                Assert.Equal(1, summary.Quantity);
            }

            // 归还 → 在库数 2
            Assert.Equal(HttpStatusCode.OK,
                (await client.PostAsJsonAsync($"/api/battery/{id1}/return", new { })).StatusCode);
            await using (var check = new AppDbContext(opts))
            {
                var summary = await check.InventoryItems.FirstAsync(i => i.Code == "BAT-SUMMARY");
                Assert.Equal(2, summary.Quantity);
            }
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
