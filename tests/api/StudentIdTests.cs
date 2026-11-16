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
/// 学号（StudentId）：设备认人的现实标识。覆盖：学号优先认人、唯一约束、仅管理员可改。
/// </summary>
public class StudentIdTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public StudentIdTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record SessionResp(string SessionToken, SessionUser User);
    private sealed record SessionUser(int Id, string Username, string? StudentId);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-sid-{Guid.NewGuid():N}.db");

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

    private async Task<string> LoginTokenAsync(HttpClient client, string dbPath, string username, string role, string? studentId = null)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
                StudentId = studentId,
            });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }

    [Fact]
    public async Task LoginById_MatchesStudentId()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await LoginTokenAsync(client, dbPath, "sidadmin", "admin", "20240001");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

            var devRes = await client.PostAsJsonAsync("/api/admin/devices", new { name = "学号认人", type = "test" });
            Assert.Equal(HttpStatusCode.Created, devRes.StatusCode);
            var dev = await devRes.Content.ReadFromJsonAsync<Dictionary<string, object>>();
            var devClient = NewClient(dbPath);
            devClient.DefaultRequestHeaders.Add("X-Device-Key", dev!["deviceKey"].ToString()!);
            devClient.DefaultRequestHeaders.Add("X-Device-Secret", dev!["secret"].ToString()!);

            // 输学号认人（学员互知的现实标识）
            var login = await devClient.PostAsJsonAsync("/api/device/login-by-id", new { identifier = "20240001" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var session = await login.Content.ReadFromJsonAsync<SessionResp>();
            Assert.Equal("20240001", session!.User.StudentId);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task StudentId_IsUnique()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await LoginTokenAsync(client, dbPath, "sidadmin2", "admin", "20240002");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

            // 第二个用户用相同学号 → 拒绝
            var dup = await client.PostAsJsonAsync("/api/admin/users",
                new { username = "siduser2", password = "pw123456", role = "member", studentId = "20240002" });
            Assert.Equal(HttpStatusCode.BadRequest, dup.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task StudentId_OnlyAdminCanChange()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await LoginTokenAsync(client, dbPath, "sidadmin3", "admin", "20240003");
            await LoginTokenAsync(client, dbPath, "sidleader", "部长", "20240004");
            await LoginTokenAsync(client, dbPath, "sidmember", "member", "20240005");

            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            int memberId;
            await using (var db = new AppDbContext(opts))
                memberId = await db.Users.Where(u => u.Username == "sidmember").Select(u => u.Id).FirstAsync();

            // 部长改普通成员的学号 → 拒绝（学号是认人身份标识，修改仅 admin）
            var leaderToken = await GetTokenAsync(client, "sidleader", "pw123456");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);
            var deny = await client.PutAsJsonAsync($"/api/admin/users/{memberId}", new { studentId = "20990001" });
            Assert.Equal(HttpStatusCode.NotFound, deny.StatusCode); // 端点对 false 映射 404「权限不足或用户不存在」

            // admin 改学号 → 允许
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
            var ok = await client.PutAsJsonAsync($"/api/admin/users/{memberId}", new { studentId = "20990002" });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    private static async Task<string> GetTokenAsync(HttpClient client, string username, string password)
    {
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }
}
