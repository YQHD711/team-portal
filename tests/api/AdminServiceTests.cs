using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>组织架构收紧:部长在本部门内最大自主,永不触碰 admin/不授予 admin,不能操作他部门。</summary>
public class AdminServiceTests
{
    // 1=leader1(飞训部 部长) 2=leader2(电训部 部长) 3=admin 4=member1(飞训部) 5=member2(电训部) 6=unassigned
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        ctx.Departments.AddRange(new Department { Id = 1, Name = "飞训部" }, new Department { Id = 2, Name = "电训部" });
        ctx.SaveChanges();
        ctx.Users.AddRange(
            new User { Id = 1, Username = "leader1", PasswordHash = "x", Role = "部长", DepartmentId = 1 },
            new User { Id = 2, Username = "leader2", PasswordHash = "x", Role = "部长", DepartmentId = 2 },
            new User { Id = 3, Username = "admin", PasswordHash = "x", Role = "admin", DepartmentId = null },
            new User { Id = 4, Username = "member1", PasswordHash = "x", Role = "member", DepartmentId = 1 },
            new User { Id = 5, Username = "member2", PasswordHash = "x", Role = "member", DepartmentId = 2 },
            new User { Id = 6, Username = "unassigned", PasswordHash = "x", Role = "member", DepartmentId = null }
        );
        ctx.SaveChanges();
        return ctx;
    }

    private static AdminService CreateService(AppDbContext db)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var scope = new TestScopeFactory(db);
        var log = new NullLogService(scope);
        var knowledge = new KnowledgeService(config, log, scope);
        return new AdminService(db, knowledge, log);
    }

    [Fact]
    public async Task Leader_CanPromoteOwnDeptMember_ToLeader()
    {
        var db = CreateContext();
        var svc = CreateService(db);

        var ok = await svc.UpdateUser(4, "部长", 1, null, null, "部长", "飞训部", 1);
        Assert.True(ok);
        Assert.Equal("部长", (await db.Users.FindAsync(4))!.Role);
    }

    [Fact]
    public async Task Leader_CannotGrantAdmin()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var ok = await svc.UpdateUser(4, "admin", 1, null, null, "部长", "飞训部", 1);
        Assert.False(ok);
        Assert.Equal("member", (await db.Users.FindAsync(4))!.Role);
    }

    [Fact]
    public async Task Leader_CannotEditOtherDeptMember()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var ok = await svc.UpdateUser(5, null, null, null, null, "部长", "飞训部", 1); // 电训部成员
        Assert.False(ok);
    }

    [Fact]
    public async Task Leader_CannotEditUnassignedMember()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var ok = await svc.UpdateUser(6, null, null, null, null, "部长", "飞训部", 1);
        Assert.False(ok);
    }

    [Fact]
    public async Task Leader_CannotTouchAdmin()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var ok = await svc.UpdateUser(3, null, null, null, null, "部长", "飞训部", 1);
        Assert.False(ok);
    }

    [Fact]
    public async Task Leader_CanMoveOwnMember_ToAnotherDept()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        // 可把本部门成员调到其它部门/未分配
        var ok = await svc.UpdateUser(4, null, 2, null, null, "部长", "飞训部", 1);
        Assert.True(ok);
        Assert.Equal(2, (await db.Users.FindAsync(4))!.DepartmentId);
    }

    [Fact]
    public async Task Leader_CanEditSelfAccount()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var ok = await svc.UpdateUser(1, null, null, "newpass", null, "部长", "飞训部", 1);
        Assert.True(ok);
    }

    [Fact]
    public async Task Admin_CanGrantAdmin()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var ok = await svc.UpdateUser(4, "admin", 1, null, null, "admin", null, 3);
        Assert.True(ok);
        Assert.Equal("admin", (await db.Users.FindAsync(4))!.Role);
    }
}
