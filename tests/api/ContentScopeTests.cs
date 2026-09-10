using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 读取范围:档案/认证对部长限本部门;wiki 目录清单路径不得穿越。
/// </summary>
public class ContentScopeTests
{
    private static AppDbContext CreateDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ClaimsPrincipal Actor(string role, int userId)
        => new(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Role, role),
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
        }, "test"));

    // ── wiki 目录清单路径 ──

    [Theory]
    [InlineData("guide/intro", true)]
    [InlineData("architecture", true)]
    [InlineData("a/b/c", true)]
    [InlineData("../secret", false)]
    [InlineData("a/../../b", false)]
    [InlineData("./a", false)]
    [InlineData("/etc/passwd", false)]
    [InlineData("C:/Windows/x", false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void CatalogPath_OnlyAllowsSafeRelativeSegments(string path, bool expected)
        => Assert.Equal(expected, WikiGeneratorService.IsSafeCatalogPath(path));

    [Fact]
    public void CatalogPath_EmptySegmentsAreCollapsed()
        => Assert.True(WikiGeneratorService.IsSafeCatalogPath("a//b"));

    [Fact]
    public void CatalogPath_RejectsTraversalHiddenAsBackslash()
    {
        Assert.False(WikiGeneratorService.IsSafeCatalogPath("..\\..\\组织部\\x"));
        Assert.False(WikiGeneratorService.IsSafeCatalogPath("a\\..\\..\\b"));
    }

    // ── 档案读取范围 ──

    private static async Task<(AppDbContext Db, int FlightDeptId, int OrgDeptId, int AdminId, int HeadId, int MemberId, int OtherId)> SeedAsync()
    {
        var db = CreateDb();
        var flight = new Department { Name = "飞训部" };
        var org = new Department { Name = "组织部" };
        db.Departments.AddRange(flight, org);
        await db.SaveChangesAsync();
        var admin = new User { Username = "admin", PasswordHash = "x", Role = "admin" };
        var head = new User { Username = "head", PasswordHash = "x", Role = "部长", DepartmentId = flight.Id };
        var member = new User { Username = "member", PasswordHash = "x", Role = "member", DepartmentId = flight.Id };
        var other = new User { Username = "other", PasswordHash = "x", Role = "member", DepartmentId = org.Id };
        db.Users.AddRange(admin, head, member, other);
        await db.SaveChangesAsync();
        return (db, flight.Id, org.Id, admin.Id, head.Id, member.Id, other.Id);
    }

    [Fact]
    public async Task DepartmentHead_CanOnlyReadOwnDepartmentProfiles()
    {
        var (db, _, _, _, headId, memberId, otherId) = await SeedAsync();
        var head = Actor("部长", headId);

        Assert.Null(await ProfileEndpoints.RequireCanViewAsync(head, db, memberId));      // 本部门
        Assert.Null(await ProfileEndpoints.RequireCanViewAsync(head, db, headId));        // 自己
        Assert.NotNull(await ProfileEndpoints.RequireCanViewAsync(head, db, otherId));    // 他部门
    }

    [Fact]
    public async Task Admin_CanReadAnyProfile_Member_ReadsNone()
    {
        var (db, _, _, adminId, _, memberId, otherId) = await SeedAsync();

        Assert.Null(await ProfileEndpoints.RequireCanViewAsync(Actor("admin", adminId), db, otherId));
        Assert.NotNull(await ProfileEndpoints.RequireCanViewAsync(Actor("member", memberId), db, memberId));
    }

    [Fact]
    public async Task ListAllProfiles_ScopedByDepartment()
    {
        var (db, flightDeptId, _, _, headId, memberId, otherId) = await SeedAsync();
        // 两个部门各一份档案
        db.PilotProfiles.AddRange(
            new PilotProfile { UserId = memberId, Level = "A" },
            new PilotProfile { UserId = otherId, Level = "B" });
        await db.SaveChangesAsync();
        var svc = new ProfileService(db, new NullLogService(new TestScopeFactory(db)));

        var all = await svc.ListAllProfiles();
        var scoped = await svc.ListAllProfiles(flightDeptId);

        Assert.Equal(2, all.Count);
        Assert.Single(scoped);
        // 部长读他部门成员 → 拒绝
        Assert.NotNull(await ProfileEndpoints.RequireCanViewAsync(Actor("部长", headId), db, otherId));
    }

    [Fact]
    public async Task ListAllCertifications_ScopedByDepartment()
    {
        var (db, flightDeptId, _, _, _, memberId, otherId) = await SeedAsync();
        db.SkillCertifications.AddRange(
            new SkillCertification { UserId = memberId, CertName = "飞行操作", Level = "A", Status = "active" },
            new SkillCertification { UserId = otherId, CertName = "地面站", Level = "B", Status = "active" });
        await db.SaveChangesAsync();
        var svc = new CertificationService(db, new NullLogService(new TestScopeFactory(db)));

        var all = await svc.ListAllCertifications();
        var scoped = await svc.ListAllCertifications(flightDeptId);

        Assert.Equal(2, all.Count);
        Assert.Single(scoped);
    }
}
