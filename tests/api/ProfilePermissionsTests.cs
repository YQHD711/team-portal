using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;
using TeamPortal.Services;

namespace api;

/// <summary>档案等级/时长权限:仅 admin 与【本部门部长】可改;未分配部门仅 admin。</summary>
public class ProfilePermissionsTests
{
    // 用户:1 admin / 2 leader1(飞控部) / 3 leader2(电控部) / 4 memberA(飞控部) / 5 memberB(电控部) / 6 unassigned
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        ctx.Departments.AddRange(
            new Department { Id = 1, Name = "飞控部" },
            new Department { Id = 2, Name = "电控部" }
        );
        ctx.SaveChanges();
        ctx.Users.AddRange(
            new User { Id = 1, Username = "admin", PasswordHash = "x", Role = "admin", DepartmentId = null },
            new User { Id = 2, Username = "leader1", PasswordHash = "x", Role = "部长", DepartmentId = 1 },
            new User { Id = 3, Username = "leader2", PasswordHash = "x", Role = "部长", DepartmentId = 2 },
            new User { Id = 4, Username = "memberA", PasswordHash = "x", Role = "member", DepartmentId = 1 },
            new User { Id = 5, Username = "memberB", PasswordHash = "x", Role = "member", DepartmentId = 2 },
            new User { Id = 6, Username = "unassigned", PasswordHash = "x", Role = "member", DepartmentId = null }
        );
        ctx.SaveChanges();
        return ctx;
    }

    [Fact]
    public async Task Admin_CanManageAnyone_IncludingUnassignedAndSelf()
    {
        var db = CreateContext();
        Assert.True(await ProfileEndpoints.CanManageAsync("admin", null, 1, db, 6));  // 未分配
        Assert.True(await ProfileEndpoints.CanManageAsync("admin", null, 1, db, 5));  // 跨部门
        Assert.True(await ProfileEndpoints.CanManageAsync("admin", null, 1, db, 1));  // 自己
    }

    [Fact]
    public async Task DeptHead_CanManageOwnDeptMember()
    {
        var db = CreateContext();
        Assert.True(await ProfileEndpoints.CanManageAsync("部长", 1, 2, db, 4)); // 飞控部部长 → 飞控部成员
    }

    [Fact]
    public async Task DeptHead_CannotManageCrossDeptMember()
    {
        var db = CreateContext();
        Assert.False(await ProfileEndpoints.CanManageAsync("部长", 1, 2, db, 5)); // 电控部成员
    }

    [Fact]
    public async Task DeptHead_CannotManageUnassignedMember()
    {
        var db = CreateContext();
        Assert.False(await ProfileEndpoints.CanManageAsync("部长", 1, 2, db, 6));
    }

    [Fact]
    public async Task DeptHead_CannotManageSelf()
    {
        var db = CreateContext();
        Assert.False(await ProfileEndpoints.CanManageAsync("部长", 1, 2, db, 2));
    }

    [Fact]
    public async Task Member_CannotManageAnyone()
    {
        var db = CreateContext();
        Assert.False(await ProfileEndpoints.CanManageAsync("member", 1, 4, db, 5));
        Assert.False(await ProfileEndpoints.CanManageAsync("member", 1, 4, db, 4)); // 连自己也不可
    }

    [Fact]
    public async Task UpdateProfile_NullLevelAndHours_KeepsExisting()
    {
        var db = CreateContext();
        var user = db.Users.First(u => u.Id == 4);
        db.PilotProfiles.Add(new PilotProfile { UserId = user.Id, Level = "学员", TotalFlightHours = 12 });
        await db.SaveChangesAsync();

        var svc = new ProfileService(db, new NullLogService(new TestScopeFactory(db)));
        // 自改接口不传 level/flightHours(null)→ 这两个字段应保持不变
        var ok = await svc.UpdateProfile(user.Id, null, null, null, null, null, null, null, null);

        Assert.True(ok);
        var profile = await db.PilotProfiles.FirstAsync(p => p.UserId == user.Id);
        Assert.Equal("学员", profile.Level);
        Assert.Equal(12, profile.TotalFlightHours);
    }

    [Fact]
    public async Task UpdateProfile_StaffFields_ChangeWhenProvided()
    {
        var db = CreateContext();
        var user = db.Users.First(u => u.Id == 4);
        db.PilotProfiles.Add(new PilotProfile { UserId = user.Id, Level = "学员", TotalFlightHours = 12 });
        await db.SaveChangesAsync();

        var svc = new ProfileService(db, new NullLogService(new TestScopeFactory(db)));
        await svc.UpdateProfile(user.Id, "中级", 30, null, null, null, null, null, null);

        var profile = await db.PilotProfiles.FirstAsync(p => p.UserId == user.Id);
        Assert.Equal("中级", profile.Level);
        Assert.Equal(30, profile.TotalFlightHours);
    }
}

/// <summary>采购申请:队员可发起(不再限 staff);查询按申请人隔离;审批流转正常。</summary>
public class FinanceServiceTests
{
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        ctx.Users.AddRange(
            new User { Id = 1, Username = "member", PasswordHash = "x", Role = "member", DepartmentId = null },
            new User { Id = 2, Username = "admin", PasswordHash = "x", Role = "admin", DepartmentId = null }
        );
        ctx.SaveChanges();
        return ctx;
    }

    private static FinanceService CreateService(AppDbContext db)
        => new(db, new NullLogService(new TestScopeFactory(db)));

    [Fact]
    public async Task CreateRequest_Member_IsPending()
    {
        var db = CreateContext();
        var svc = CreateService(db);

        var req = await svc.CreateRequest(1, "桨叶", 2, 120m, "训练损耗");

        Assert.Equal("pending", req.Status);
        Assert.Equal(1, req.RequesterUserId);
        Assert.Equal(2, req.Quantity);
    }

    [Fact]
    public async Task GetRequests_FiltersByRequester()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        await svc.CreateRequest(1, "A", 1, 10m, "x");
        await svc.CreateRequest(2, "B", 1, 20m, "y");

        var mine = await svc.GetRequests(null, 1);
        Assert.Single(mine);
        Assert.Equal("A", mine[0].ItemName);
    }

    [Fact]
    public async Task Approve_FlipsPendingToApproved()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        var req = await svc.CreateRequest(1, "桨叶", 1, 120m, "z");

        var ok = await svc.Approve(req.Id, 2);

        Assert.True(ok);
        var reloaded = await db.PurchaseRequests.FindAsync(req.Id);
        Assert.Equal("approved", reloaded!.Status);
        Assert.Equal(2, reloaded.ApproverUserId);
    }
}
