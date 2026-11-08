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
/// 电池字段校验（长度/非法字符）与删除接口：
/// 超长/脚本片段 → 400；DELETE 仅 admin，在借拒绝，删除后查不到且流水级联清理。
/// </summary>
public class BatteryValidationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public BatteryValidationTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record BatteryResp(int Id, string Code);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-bv-{Guid.NewGuid():N}.db");

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

    /// <summary>seed 用户并登录，返回 token（同一 host 可先后切换不同用户，避免多 host 抢同一 SQLite 文件）。</summary>
    private async Task<string> LoginTokenAsync(HttpClient client, string dbPath, string username, string role)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
            });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }

    private async Task<HttpClient> LoginAsync(string dbPath, string username, string role)
    {
        var client = NewClient(dbPath);
        var token = await LoginTokenAsync(client, dbPath, username, role);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<BatteryResp> CreateBatteryAsync(HttpClient client, string? code = null, string? model = null)
    {
        var res = await client.PostAsJsonAsync("/api/battery", new { code, model });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<BatteryResp>())!;
    }

    [Fact]
    public async Task Create_OversizedCode_Returns400()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin", "admin");
            var res = await admin.PostAsJsonAsync("/api/battery", new { code = new string('L', 300), model = "x" });
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Create_OversizedModel_Returns400()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin2", "admin");
            var res = await admin.PostAsJsonAsync("/api/battery", new { code = "BAT-8001", model = new string('A', 500) });
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Create_UnsafeModel_Returns400()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin3", "admin");
            var res = await admin.PostAsJsonAsync("/api/battery", new { code = "BAT-8002", model = "<script>alert(1)</script>" });
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Create_UnsafeNotes_Returns400()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin4", "admin");
            var res = await admin.PostAsJsonAsync("/api/battery", new { code = "BAT-8003", notes = "<img src=x onerror=alert(1)>" });
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Create_Valid_Returns201()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin5", "admin");
            var item = await CreateBatteryAsync(admin, null, "6S 3300mAh");
            Assert.StartsWith("BAT-", item.Code);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Delete_ByAdmin_RemovesBatteryAndLoans()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin6", "admin");
            var item = await CreateBatteryAsync(admin, "BAT-8100", "删除测试");
            // 借出再归还，产生流水
            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/battery/{item.Id}/borrow", new { })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/battery/{item.Id}/return", new { })).StatusCode);

            var del = await admin.DeleteAsync($"/api/battery/{item.Id}");
            Assert.Equal(HttpStatusCode.OK, del.StatusCode);

            var byCode = await admin.GetAsync("/api/battery/by-code/BAT-8100");
            Assert.Equal(HttpStatusCode.NotFound, byCode.StatusCode);

            // 流水随电池级联删除
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using var db = new AppDbContext(opts);
            Assert.False(await db.BatteryLoans.AnyAsync(l => l.BatteryId == item.Id));
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Delete_ByMember_Returns403()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var adminToken = await LoginTokenAsync(client, dbPath, "badmin7", "admin");
            var memberToken = await LoginTokenAsync(client, dbPath, "bmember7", "member");

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
            var item = await CreateBatteryAsync(client, "BAT-8101");

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", memberToken);
            var res = await client.DeleteAsync($"/api/battery/{item.Id}");
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Delete_Borrowed_Returns409()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin8", "admin");
            var item = await CreateBatteryAsync(admin, "BAT-8102");
            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/battery/{item.Id}/borrow", new { })).StatusCode);

            var res = await admin.DeleteAsync($"/api/battery/{item.Id}");
            Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Delete_NotExists_Returns404()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "badmin9", "admin");
            var res = await admin.DeleteAsync("/api/battery/99999");
            Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
