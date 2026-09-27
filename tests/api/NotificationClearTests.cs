using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 通知「清除」的语义：清的是**我的**列表，不是数据库里的通知行。
///
/// 通知行是共享的（UserId=null 时全员或按 TargetRole 可见），如果直接删行，
/// 管理员点一次「清除」就会把全队的铃铛一起清空 —— 所以按用户打标记，
/// 查询时排除；别人照旧看得见。这里把这条语义钉死。
/// </summary>
public class NotificationClearTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly NotificationService _svc;
    private readonly int _me = 1;
    private readonly int _other = 2;

    public NotificationClearTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
        _svc = new NotificationService(new TestScopeFactory(_db), new NullLogService(new TestScopeFactory(_db)));

        _db.Users.AddRange(new User { Id = _me, Username = "me", PasswordHash = "x" },
                           new User { Id = _other, Username = "other", PasswordHash = "x" });
        _db.SaveChanges();
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }

    private void SeedNotifications()
    {
        _db.Notifications.AddRange(
            new Notification { Title = "给我的", Message = "个人通知", UserId = _me },
            new Notification { Title = "给别人的", Message = "他人通知", UserId = _other },
            new Notification { Title = "全员", Message = "公告", UserId = null, TargetRole = null },
            new Notification { Title = "给部长", Message = "staff 通知", UserId = null, TargetRole = "staff" },
            new Notification { Title = "给管理员", Message = "admin 通知", UserId = null, TargetRole = "admin" });
        _db.SaveChanges();
    }

    [Fact]
    public async Task Clear_HidesOnlyMyVisibleNotifications()
    {
        SeedNotifications();

        var cleared = await _svc.ClearAll(_me, "member");
        Assert.Equal(2, cleared);   // 我的个人通知 + 全员公告（staff/admin 的看不到也不清）

        var mine = await _svc.GetNotifications(_me, "member");
        Assert.Empty(mine);
    }

    [Fact]
    public async Task Clear_DoesNotTouchOtherUsers()
    {
        SeedNotifications();
        await _svc.ClearAll(_me, "member");

        // 别人（同一个部门/角色）看到的公告与自己的个人通知必须完好
        var others = await _svc.GetNotifications(_other, "member");
        Assert.Equal(2, others.Count);
        Assert.Contains(others, n => n.Title == "给别人的");
        Assert.Contains(others, n => n.Title == "全员");
    }

    [Fact]
    public async Task Clear_DoesNotDeleteSharedRows()
    {
        SeedNotifications();
        await _svc.ClearAll(_me, "member");

        // 通知行本身必须还在（只是对我打了清除标记）
        Assert.Equal(5, await _db.Notifications.CountAsync());
        Assert.Equal(2, await _db.NotificationDismissals.CountAsync(d => d.UserId == _me));
    }

    [Fact]
    public async Task Clear_IsIdempotent()
    {
        SeedNotifications();

        Assert.Equal(2, await _svc.ClearAll(_me, "member"));
        Assert.Equal(0, await _svc.ClearAll(_me, "member"));
        Assert.Equal(2, await _db.NotificationDismissals.CountAsync(d => d.UserId == _me));
    }

    [Fact]
    public async Task Clear_ZeroesMyUnreadCount_ButNotOthers()
    {
        SeedNotifications();

        Assert.True(await _svc.GetUnreadCount(_me, "member") > 0);
        await _svc.ClearAll(_me, "member");
        Assert.Equal(0, await _svc.GetUnreadCount(_me, "member"));
        Assert.True(await _svc.GetUnreadCount(_other, "member") > 0);
    }

    [Fact]
    public async Task Staff_SeesRoleTargetedNotifications()
    {
        SeedNotifications();

        // 部长可见：自己的 + 全员 + staff 目标（3 条）；清除后再看应为空
        var cleared = await _svc.ClearAll(_me, "部长");
        Assert.Equal(3, cleared);
        Assert.Empty(await _svc.GetNotifications(_me, "部长"));
        // admin 目标的那条对部长不可见，所以也没被清 —— 换 admin 视角仍能看到
        Assert.Contains(await _svc.GetNotifications(_me, "admin"), n => n.Title == "给管理员");
    }

    [Fact]
    public async Task Clear_OnEmptyList_IsNotAnError()
    {
        Assert.Equal(0, await _svc.ClearAll(_me, "member"));
    }
}
