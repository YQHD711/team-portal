using System.Security.Claims;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 身份判定必须以**数据库当前值**为准，不能读 JWT 声明。
///
/// 全仓没有 token 失效机制，token 默认活 7 天（Auth:JwtExpireDays）：
/// 改角色 / 改部门之后，旧 token 会带着旧身份继续用满 7 天 ——
/// 被免职的部长仍按部长算可见范围、换部门的人仍搜得到原部门的文档。
/// 这里钉住「搜索 / AI 检索」这两处（它们曾是全仓仅有的两处读声明的）。
/// </summary>
public class CurrentUserScopeTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public CurrentUserScopeTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
    }

    private async Task<User> SeedAsync(string role, string deptName)
    {
        var dept = new Department { Name = deptName };
        _db.Departments.Add(dept);
        await _db.SaveChangesAsync();
        var u = new User { Username = "u", PasswordHash = "x", Role = role, DepartmentId = dept.Id };
        _db.Users.Add(u);
        await _db.SaveChangesAsync();
        return u;
    }

    /// <summary>构造一个"带旧身份声明"的 token 主体。</summary>
    private static ClaimsPrincipal PrincipalWithStaleClaims(int userId, string staleRole, string staleDept)
        => new(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Name, "u"),
            new Claim(ClaimTypes.Role, staleRole),
            new Claim("Department", staleDept),
        ], "test"));

    [Fact]
    public async Task TakesCurrentRoleAndDepartmentFromDb_NotStaleTokenClaims()
    {
        var user = await SeedAsync("member", "电子部");
        // token 里还是老身份：部长 @ 飞训部
        var principal = PrincipalWithStaleClaims(user.Id, "部长", "飞训部");

        var (role, dept, id) = await CurrentUser.FromDbAsync(principal, _db);

        Assert.Equal("member", role);      // ← 以库为准，被免职后立刻失去部长视角
        Assert.Equal("电子部", dept);       // ← 换部门后立刻按新部门算
        Assert.Equal(user.Id, id);
    }

    [Fact]
    public async Task DeletedUser_YieldsEmptyIdentity()
    {
        await SeedAsync("member", "电子部");
        var principal = PrincipalWithStaleClaims(99999, "admin", "飞训部");

        var (role, dept, id) = await CurrentUser.FromDbAsync(principal, _db);

        Assert.Null(role);
        Assert.Null(dept);
        Assert.Equal(0, id);
    }

    [Fact]
    public async Task MissingOrMalformedNameIdentifier_YieldsEmptyIdentity()
    {
        var noId = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "admin")], "test"));
        var badId = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, "not-a-number"), new Claim(ClaimTypes.Role, "admin")], "test"));

        Assert.Equal((null, null, 0), await CurrentUser.FromDbAsync(noId, _db));
        Assert.Equal((null, null, 0), await CurrentUser.FromDbAsync(badId, _db));
    }

    [Fact]
    public async Task UserWithoutDepartment_YieldsNullDepartment()
    {
        var u = new User { Username = "solo", PasswordHash = "x", Role = "member", DepartmentId = null };
        _db.Users.Add(u);
        await _db.SaveChangesAsync();

        var (role, dept, id) = await CurrentUser.FromDbAsync(PrincipalWithStaleClaims(u.Id, "member", "飞训部"), _db);

        Assert.Equal("member", role);
        Assert.Null(dept);       // 不能把 token 里的旧部门带出来
        Assert.Equal(u.Id, id);
    }

    /// <summary>仓库根目录（从测试程序集目录往上找 src/TeamPortal）。</summary>
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src", "TeamPortal")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("找不到仓库根目录");
    }

    /// <summary>
    /// 守卫：这两个端点**不得**再从 JWT 声明读身份。
    /// 它们曾经是全仓仅有的两处读声明的地方 —— 改成查库后，别被写回去。
    /// </summary>
    [Theory]
    [InlineData("src/TeamPortal/Endpoints/SearchEndpoints.cs")]
    [InlineData("src/TeamPortal/Endpoints/AiEndpoints.cs")]
    public void Endpoints_DoNotReadIdentityFromTokenClaims(string relativePath)
    {
        var full = Path.Combine(RepoRoot(), relativePath.Replace('/', Path.DirectorySeparatorChar));
        var src = File.ReadAllText(full);

        Assert.DoesNotContain("FindFirstValue(\"Department\")", src);
        Assert.DoesNotContain("FindFirstValue(ClaimTypes.Role)", src);
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }
}
