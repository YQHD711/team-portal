using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 邀请码权限:部长可生成(仅本部门或不限),互相隔离(只管理自己生成的);admin 全量。
/// </summary>
public class InviteCodeTests
{
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        ctx.Departments.AddRange(
            new Department { Id = 1, Name = "飞训部" },
            new Department { Id = 2, Name = "电子部" }
        );
        ctx.SaveChanges();
        ctx.Users.AddRange(
            new User { Id = 1, Username = "admin", PasswordHash = "x", Role = "admin", DepartmentId = null },
            new User { Id = 2, Username = "leader1", PasswordHash = "x", Role = "部长", DepartmentId = 1 },
            new User { Id = 3, Username = "leader2", PasswordHash = "x", Role = "部长", DepartmentId = 2 },
            new User { Id = 4, Username = "member", PasswordHash = "x", Role = "member", DepartmentId = null }
        );
        ctx.SaveChanges();
        return ctx;
    }

    private static AuthService CreateAuth(AppDbContext db)
        => new(db, CreateConfig(), new NullLogService(new TestScopeFactory(db)), CreateSettings(db));

    private static IConfiguration CreateConfig()
    {
        var dict = new Dictionary<string, string?>
        {
            ["Jwt:Key"] = "this-is-a-test-key-at-least-32-characters-long!!",
            ["Jwt:Issuer"] = "test",
            ["Jwt:Audience"] = "test"
        };
        return new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
    }

    private static SettingsService CreateSettings(AppDbContext db) => new(new TestScopeFactory(db));

    [Fact]
    public async Task Leader_CannotGenerate_ForOtherDepartment()
    {
        var db = CreateContext();
        var auth = CreateAuth(db);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            auth.GenerateInviteCode(2, deptId: 2, actorRole: "部长", actorDeptId: 1)); // 邀到电子部
    }

    [Fact]
    public async Task Leader_CanGenerate_OwnDeptOrNone()
    {
        var db = CreateContext();
        var auth = CreateAuth(db);

        var own = await auth.GenerateInviteCode(2, 1, "部长", 1);      // 本部门
        var any = await auth.GenerateInviteCode(2, null, "部长", 1);    // 不限
        Assert.Equal(1, own.DepartmentId);
        Assert.Null(any.DepartmentId);
    }

    [Fact]
    public async Task Admin_CanGenerate_AnyDepartment()
    {
        var db = CreateContext();
        var auth = CreateAuth(db);
        var code = await auth.GenerateInviteCode(1, 2, "admin", null); // admin 邀到电子部
        Assert.Equal(2, code.DepartmentId);
    }

    [Fact]
    public async Task GetInviteCodes_DeptHead_SeesOnlyOwn()
    {
        var db = CreateContext();
        var auth = CreateAuth(db);
        await auth.GenerateInviteCode(2, 1, "部长", 1);
        await auth.GenerateInviteCode(3, 2, "部长", 2);
        await auth.GenerateInviteCode(1, null, "admin", null);

        var leaderView = await auth.GetInviteCodes("部长", 2);
        var adminView = await auth.GetInviteCodes("admin", 1);

        Assert.Single(leaderView); // 部长互相不可见
        Assert.Equal(3, adminView.Count); // admin 全量
    }

    [Fact]
    public async Task Revoke_ForeignCode_Forbidden()
    {
        var db = CreateContext();
        var auth = CreateAuth(db);
        var code2 = await auth.GenerateInviteCode(3, 2, "部长", 2); // leader2 的码

        var asLeader1 = await auth.RevokeInviteCode(code2.Id, "部长", 2);
        Assert.Equal(AuthService.InviteOp.Forbidden, asLeader1);

        var asAdmin = await auth.RevokeInviteCode(code2.Id, "admin", 1);
        Assert.Equal(AuthService.InviteOp.Ok, asAdmin);
    }

    [Fact]
    public async Task Delete_OwnCode_Allowed_Foreign_Forbidden()
    {
        var db = CreateContext();
        var auth = CreateAuth(db);
        var mine = await auth.GenerateInviteCode(2, 1, "部长", 1);
        var other = await auth.GenerateInviteCode(3, 2, "部长", 2);

        Assert.Equal(AuthService.InviteOp.Forbidden, await auth.DeleteInviteCode(other.Id, "部长", 2));
        Assert.Equal(AuthService.InviteOp.Ok, await auth.DeleteInviteCode(mine.Id, "部长", 2));
    }

    // ── 注册:邀请码名额占用 ──

    [Fact]
    public async Task Register_ValidCode_ConsumesOneSlotAndInheritsDepartment()
    {
        var db = CreateContext();
        db.InviteCodes.Add(new InviteCode
        {
            Code = "GOOD", MaxUses = 2, DepartmentId = 1, CreatedByUserId = 2,
            ExpiresAt = DateTime.UtcNow.AddDays(1)
        });
        await db.SaveChangesAsync();

        var user = await CreateAuth(db).Register("newbie", "pw123456", "GOOD");

        Assert.NotNull(user);
        Assert.Equal(1, user!.DepartmentId);
        Assert.Equal(2, user.InvitedByUserId);
        Assert.Equal(1, (await db.InviteCodes.AsNoTracking().FirstAsync(c => c.Code == "GOOD")).UsedCount);
    }

    [Fact]
    public async Task Register_ExhaustedInDbButStaleInTracker_IsRejected()
    {
        // 模拟并发下的陈旧读:变更跟踪器里仍是 UsedCount=0,而另一个并发请求
        // 已经把名额用掉(库里 = MaxUses)。旧实现只信内存快照 → 会再放过一次注册,
        // 使 UsedCount 超过 MaxUses;现在由条件 UPDATE 在数据库侧定胜负。
        var db = CreateContext();
        db.InviteCodes.Add(new InviteCode
        {
            Code = "RACE", MaxUses = 1, CreatedByUserId = 1, ExpiresAt = DateTime.UtcNow.AddDays(1)
        });
        await db.SaveChangesAsync();
        _ = await db.InviteCodes.FirstAsync(c => c.Code == "RACE"); // 进入跟踪器(UsedCount=0)
        await db.Database.ExecuteSqlRawAsync("UPDATE InviteCodes SET UsedCount = 1 WHERE Code = 'RACE'");

        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateAuth(db).Register("newbie", "pw123456", "RACE"));

        Assert.False(await db.Users.AnyAsync(u => u.Username == "newbie"));
        Assert.Equal(1, (await db.InviteCodes.AsNoTracking().FirstAsync(c => c.Code == "RACE")).UsedCount);
    }

    [Fact]
    public async Task Register_ShortPassword_DoesNotConsumeInviteSlot()
    {
        // 名额占用改为原生 UPDATE 后会立即提交,因此密码长度等校验必须排在它之前,
        // 否则一次输错密码就作废一个邀请码名额。
        var db = CreateContext();
        db.InviteCodes.Add(new InviteCode
        {
            Code = "SHORT", MaxUses = 1, CreatedByUserId = 1, ExpiresAt = DateTime.UtcNow.AddDays(1)
        });
        db.SystemSettings.Add(new SystemSetting { Key = "Auth:PasswordMinLength", Value = "8" });
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateAuth(db).Register("newbie", "short", "SHORT"));

        Assert.Equal(0, (await db.InviteCodes.AsNoTracking().FirstAsync(c => c.Code == "SHORT")).UsedCount);
    }
}
