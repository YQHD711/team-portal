using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// Token 失效机制。
///
/// 回归的原始缺陷：JWT 默认活 7 天且声明不可撤销，全仓没有失效机制 ——
/// 改角色 / 改部门 / 改密码之后，旧 token 带着旧身份继续通过鉴权与授权策略校验。
/// 「被免职的部长、被删掉的管理员在 7 天内仍是部长/管理员」。
///
/// 修法：User.TokenVersion，签发时写进 claim，校验时比对；改角色/部门/密码时自增。
/// </summary>
public class TokenRevocationTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public TokenRevocationTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }

    // ── 签发侧 ──

    private static AuthService CreateAuth(AppDbContext db)
    {
        var scopes = new TestScopeFactory(db);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = new string('k', 40),
                ["Jwt:Issuer"] = "TeamPortal",
                ["Jwt:Audience"] = "TeamPortal",
            }).Build();
        return new AuthService(db, config, new NullLogService(scopes), new SettingsService(scopes));
    }

    [Fact]
    public async Task IssuedToken_CarriesTokenVersionClaim()
    {
        var user = new User { Username = "u", PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"), Role = "member", TokenVersion = 7 };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        var token = await CreateAuth(_db).Login("u", "pw123456");

        Assert.NotNull(token);
        var jwt = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("7", jwt.Claims.FirstOrDefault(c => c.Type == AuthService.TokenVersionClaim)?.Value);
    }

    // ── 触发侧 ──

    private async Task<(User user, User admin)> SeedAsync()
    {
        var dept = new Department { Name = "飞训部" };
        _db.Departments.Add(dept);
        await _db.SaveChangesAsync();
        var user = new User { Username = "u", PasswordHash = BCrypt.Net.BCrypt.HashPassword("oldpw123456"), Role = "部长", DepartmentId = dept.Id };
        var admin = new User { Username = "boss", PasswordHash = "x", Role = "admin" };
        _db.Users.AddRange(user, admin);
        await _db.SaveChangesAsync();
        return (user, admin);
    }

    [Fact]
    public async Task ChangePassword_BumpsVersion()
    {
        var (user, _) = await SeedAsync();
        var before = user.TokenVersion;

        var ok = await CreateAuth(_db).ChangePassword(user.Id, "oldpw123456", "newpw123456");

        Assert.True(ok);
        Assert.Equal(before + 1, (await _db.Users.FindAsync(user.Id))!.TokenVersion);
    }

    [Theory]
    [InlineData("role")]
    [InlineData("dept")]
    [InlineData("password")]
    public async Task AdminUpdate_SecurityRelevantChange_BumpsVersion(string what)
    {
        var (user, admin) = await SeedAsync();
        var svc = new AdminService(_db, null!, new NullLogService(new TestScopeFactory(_db)));
        var before = user.TokenVersion;

        await svc.UpdateUser(user.Id,
            userRole: what == "role" ? "member" : null,
            deptId: what == "dept" ? 0 : null,
            password: what == "password" ? "resetme12345" : null,
            username: null, currentRole: "admin", currentDept: null, currentUserId: admin.Id);

        Assert.Equal(before + 1, (await _db.Users.FindAsync(user.Id))!.TokenVersion);
    }

    [Fact]
    public async Task AdminUpdate_UsernameOnly_DoesNotBump()
    {
        // 改个显示名不该把人踢下线
        var (user, admin) = await SeedAsync();
        var svc = new AdminService(_db, null!, new NullLogService(new TestScopeFactory(_db)));
        var before = user.TokenVersion;

        await svc.UpdateUser(user.Id, userRole: null, deptId: null, password: null,
            username: "新名字", currentRole: "admin", currentDept: null, currentUserId: admin.Id);

        Assert.Equal(before, (await _db.Users.FindAsync(user.Id))!.TokenVersion);
    }
}

/// <summary>
/// 端到端：拿真 token 登录 → 改角色 → **同一个 token 立刻失效**。
/// 这是整套机制的最终验收（补上面那些单测只验证了"版本被自增"）。
/// </summary>
public class TokenRevocationEndToEndTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public TokenRevocationEndToEndTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task StaleToken_IsRejectedAfterRoleChange()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-revoke-{Guid.NewGuid():N}.db");
        var jwtKey = new string('k', 40);
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", jwtKey);
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        try
        {
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;

            // 应用启动已完成迁移+种子，这里写入一个可登录的用户
            int userId;
            await using (var seed = new AppDbContext(opts))
            {
                var u = new User
                {
                    Username = "member1",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                    Role = "member",
                };
                seed.Users.Add(u);
                await seed.SaveChangesAsync();
                userId = u.Id;
            }

            // 真登录拿 token
            var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "member1", password = "pw123456" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
            Assert.False(string.IsNullOrWhiteSpace(token));

            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);

            // 管理员把他提升/降级（等价于免职）→ 库里 TokenVersion 自增
            await using (var bump = new AppDbContext(opts))
            {
                var u = await bump.Users.FindAsync(userId);
                u!.Role = "member";
                u.TokenVersion++;
                await bump.SaveChangesAsync();
            }

            // 同一个 token 必须立刻失效，而不是继续用满 7 天
            var after = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }

    private sealed record LoginResp(string Token);

    /// <summary>
    /// 前端 UserMenu 发出的 body 必须被服务端的 ChangePasswordRequest(CurrentPassword, NewPassword) 接受。
    /// 曾经前端发 {{current, newPwd}}，两边字段名对不上 → 服务端永远 400，
    /// UI 却显示"当前密码错误"，把接口契约问题伪装成用户记错密码。
    /// 这条测试从服务端一侧钉住契约，前端一侧由 web/tests/user-menu-password.test.tsx 钉住。
    /// </summary>
    [Fact]
    public async Task ChangePassword_AcceptsThePayloadTheFrontendActuallySends()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-pwd-{Guid.NewGuid():N}.db");
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        try
        {
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var seed = new AppDbContext(opts))
            {
                seed.Users.Add(new User
                {
                    Username = "pwuser",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("oldpw123456"),
                    Role = "member",
                });
                await seed.SaveChangesAsync();
            }

            var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "pwuser", password = "oldpw123456" });
            var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);

            // web/components/layout/UserMenu.tsx: api.put("/api/auth/change-password", { currentPassword, newPassword })
            var res = await client.PutAsJsonAsync("/api/auth/change-password", new { currentPassword = "oldpw123456", newPassword = "newpw123456" });

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);

            // 改完密码，旧 token 必须失效（改密码 = 把别处的登录踢下线）
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);

            // 新密码能登上，旧密码不能
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/login", new { username = "pwuser", password = "newpw123456" })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/login", new { username = "pwuser", password = "oldpw123456" })).StatusCode);
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }
}
