using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 用户公开 slug。
///
/// 动机：档案页原本是 /admin/profiles/5 —— 自增 ID 可顺序枚举，更要命的是
/// **导库/重建库后会重排**，旧链接会静默指向另一个人（比 404 难发现得多）。
/// slug 与主键解耦：不可枚举、稳定、与改名无关。
/// </summary>
public class UserSlugTests
{
    [Fact]
    public void NewUserSlug_IsOpaqueAndUnique()
    {
        var a = Slug.NewUser();
        var b = Slug.NewUser();

        Assert.StartsWith("u_", a);
        Assert.Equal(18, a.Length);           // "u_" + 16 位十六进制
        Assert.NotEqual(a, b);
        Assert.True(Slug.LooksLike(a, Slug.UserPrefix));
        // 不能是数字（否则又变成可枚举的）
        Assert.False(int.TryParse(a.AsSpan(2), out _));
    }

    [Theory]
    [InlineData("u_abc123", true)]
    [InlineData("u_ABCDEF", true)]     // 十六进制大小写都认
    [InlineData("u_", false)]          // 只有前缀不算
    [InlineData("5", false)]           // 旧的自增 ID
    [InlineData("x_abc123", false)]    // 前缀不对
    [InlineData("u_xyz", false)]       // 非十六进制
    [InlineData("", false)]
    [InlineData(null, false)]
    public void LooksLike_DistinguishesSlugFromNumericId(string? value, bool expected)
        => Assert.Equal(expected, Slug.LooksLike(value, Slug.UserPrefix));

    [Fact]
    public async Task CreateUser_AssignsSlug()
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        var scopes = new TestScopeFactory(db);
        var svc = new AdminService(db, null!, new NullLogService(scopes));

        var user = await svc.CreateUser("newbie", "pw123456", "member", null, "admin", null);

        Assert.NotNull(user);
        Assert.True(Slug.LooksLike(user!.Slug, Slug.UserPrefix));
    }

    [Fact]
    public async Task GetUserIdBySlug_ResolvesAndRejectsUnknown()
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        var user = new User { Username = "u1", PasswordHash = "x", Role = "member", Slug = "u_deadbeef1234" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var scopes = new TestScopeFactory(db);
        var profiles = new ProfileService(db, new NullLogService(scopes));

        Assert.Equal(user.Id, await profiles.GetUserIdBySlug("u_deadbeef1234"));
        Assert.Null(await profiles.GetUserIdBySlug("u_nope"));
        Assert.Null(await profiles.GetUserIdBySlug(""));
        // 旧的自增 ID 不再能当 slug 用
        Assert.Null(await profiles.GetUserIdBySlug(user.Id.ToString()));
    }
}

/// <summary>
/// 端到端：档案页只认 slug —— 用数字 ID 去打必须失败，否则"不可枚举"就等于没做。
/// </summary>
public class ProfileSlugEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public ProfileSlugEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    /// <summary>actorDeptId / targetDeptId 分开传：跨部门可见性要靠两者不同才测得出来</summary>
    private async Task<(HttpClient Client, int UserId, string Slug)> SetupAsync(
        string dbPath, string username, string role, int? actorDeptId, int? targetDeptId = null)
    {
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        int userId;
        string slug = "u_test0001abcd";
        await using (var seed = new AppDbContext(opts))
        {
            var target = new User
            {
                Username = "target", PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = "member", Slug = slug,
                DepartmentId = targetDeptId ?? actorDeptId,
            };
            seed.Users.Add(target);
            seed.Users.Add(new User
            {
                Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role, Slug = Slug.NewUser(), DepartmentId = actorDeptId,
            });
            await seed.SaveChangesAsync();
            userId = target.Id;
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, userId, slug);
    }

    [Fact]
    public async Task Profile_IsReachableBySlug()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-slug-{Guid.NewGuid():N}.db");
        try
        {
            var (client, _, slug) = await SetupAsync(dbPath, "boss", "admin", null);

            var res = await client.GetAsync($"/api/admin/profiles/{slug}");

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var body = await res.Content.ReadAsStringAsync();
            Assert.Contains("target", body);
            Assert.Contains(slug, body); // 响应里也带上 slug，前端才能拼链接
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Profile_IsNotReachableByNumericId()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-slug-{Guid.NewGuid():N}.db");
        try
        {
            var (client, userId, _) = await SetupAsync(dbPath, "boss", "admin", null);

            // 旧地址形态必须失效 —— 否则还能顺序枚举，改 slug 就白改了
            var res = await client.GetAsync($"/api/admin/profiles/{userId}");

            Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DepartmentHead_CannotOpenOtherDepartmentsProfileBySlug()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-slug-{Guid.NewGuid():N}.db");
        try
        {
            // 部长在 2 号部门，目标在 1 号部门 —— 两者必须不同，否则测的是"同部门可见"
            var (client, _, slug) = await SetupAsync(dbPath, "head", "部长", actorDeptId: 2, targetDeptId: 1);

            var res = await client.GetAsync($"/api/admin/profiles/{slug}");

            // 换 slug 不改变权限：跨部门仍然被拒，绝不放行
            Assert.True(res.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
                $"期望被拒，实际 {(int)res.StatusCode}");
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DepartmentHead_CanOpenOwnDepartmentsProfileBySlug()
    {
        // 与上一条配对：确认拦住的是跨部门，而不是把同部门也误伤
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-slug-{Guid.NewGuid():N}.db");
        try
        {
            var (client, _, slug) = await SetupAsync(dbPath, "head", "部长", actorDeptId: 1, targetDeptId: 1);

            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/admin/profiles/{slug}")).StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
