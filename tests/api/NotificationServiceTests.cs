using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 通知特性测试:可见性过滤(IsVisibleTo)、Level 字段持久化、MarkAllRead 隔离、SSE 分发。
/// 串行执行由 tests/api/xunit.runner.json (parallelizeTestCollections: false) 全局保证,
/// 避免 SQLite 内存共享模式与并行不兼容。
/// </summary>
public class NotificationServiceTests
{
    private AppDbContext CreateContext()
    {
        // shared cache + 唯一 cache 名:NotificationService 内部 CreateScope 创建的 DbContext
        // 与本测试 ctx 共享同一内存库;同时避免测试间数据污染
        var cacheName = $"tp-notif-{Guid.NewGuid():N}";
        var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source=file:{cacheName}?mode=memory&cache=shared");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        return ctx;
    }

    private NotificationService CreateService(AppDbContext db)
        => new(new TestScopeFactory(db), new NullLogService(new TestScopeFactory(db)));

    // ── IsVisibleTo 静态可见性规则 ──────────────────────────

    [Theory]
    [InlineData("admin",   true)]   // admin 可见 staff
    [InlineData("部长",    true)]   // 部长可见 staff
    [InlineData("member",  false)]  // 普通成员不可见 staff
    [InlineData(null,      false)]  // 未登录不可见
    public void IsVisibleTo_StaffTargetRole(string? role, bool expected)
    {
        var n = new Notification { Title = "x", Message = "y", TargetRole = "staff" };
        Assert.Equal(expected, NotificationService.IsVisibleTo(n, userId: 1, role));
    }

    [Theory]
    [InlineData("admin",   true)]
    [InlineData("部长",    false)]
    [InlineData("member",  false)]
    public void IsVisibleTo_AdminTargetRole(string? role, bool expected)
    {
        var n = new Notification { Title = "x", Message = "y", TargetRole = "admin" };
        Assert.Equal(expected, NotificationService.IsVisibleTo(n, userId: 1, role));
    }

    [Theory]
    [InlineData("admin")]
    [InlineData("部长")]
    [InlineData("member")]
    [InlineData(null)]
    public void IsVisibleTo_NullTargetRole_VisibleToEveryone(string? role)
    {
        var n = new Notification { Title = "x", Message = "y", TargetRole = null };
        Assert.True(NotificationService.IsVisibleTo(n, userId: 1, role));
    }

    [Fact]
    public void IsVisibleTo_UserSpecific_OnlyThatUser()
    {
        var n = new Notification { Title = "x", Message = "y", UserId = 42 };
        Assert.True(NotificationService.IsVisibleTo(n, userId: 42, role: "member"));
        Assert.False(NotificationService.IsVisibleTo(n, userId: 99, role: "member"));
        // 即使 UserId 已设置,admin 也不该看别人的
        Assert.False(NotificationService.IsVisibleTo(n, userId: 99, role: "admin"));
    }

    // ── Notify + GetNotifications 端到端 ──────────────────────

    [Fact]
    public async Task GetNotifications_StaffTargetRole_HiddenFromMembers()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        svc.Notify("仅管理员可见", "采购审批", targetRole: "staff");
        // 等待 channel 处理(批窗口 500ms)
        await Task.Delay(700);

        var memberView = await svc.GetNotifications(1, role: "member");
        var staffView = await svc.GetNotifications(2, role: "admin");
        var deptView = await svc.GetNotifications(3, role: "部长");

        Assert.Empty(memberView);
        Assert.Single(staffView);
        Assert.Single(deptView);
        Assert.Equal("仅管理员可见", staffView[0].Title);
    }

    [Fact]
    public async Task Notify_StoresLevel_AndPayloadJson()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        svc.Notify("低库存", "X 仅剩 1 件", level: "critical", payloadJson: "{\"itemId\":42}");
        await Task.Delay(700);

        var list = await svc.GetNotifications(1, role: "admin");
        Assert.Single(list);
        Assert.Equal("critical", list[0].Level);
        Assert.Equal("{\"itemId\":42}", list[0].PayloadJson);
    }

    [Fact]
    public async Task MarkAllRead_OnlyAffectsVisible()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        svc.Notify("成员可见", "普通事件");
        svc.Notify("管理员可见", "采购", targetRole: "staff");
        svc.Notify("管理员仅见", "系统错误", targetRole: "admin");
        await Task.Delay(800);

        // 确认 DB 持久化 3 条(AsNoTracking 绕过 change tracker 缓存)
        var allInDb = db.Notifications.AsNoTracking().ToList();
        Assert.Equal(3, allInDb.Count);

        await svc.MarkAllRead(1, role: "member");
        await Task.Delay(100);

        var afterUpdate = db.Notifications.AsNoTracking().ToList();
        Assert.Equal(3, afterUpdate.Count);
        Assert.True(afterUpdate.First(n => n.Title == "成员可见").IsRead);
        Assert.False(afterUpdate.First(n => n.Title == "管理员可见").IsRead);
        Assert.False(afterUpdate.First(n => n.Title == "管理员仅见").IsRead);

        // 视角隔离:member 看不到 admin/staff 通知
        var memberList = await svc.GetNotifications(1, role: "member");
        Assert.Single(memberList);
        Assert.DoesNotContain(memberList, n => n.Title == "管理员仅见");
        Assert.DoesNotContain(memberList, n => n.Title == "管理员可见");
    }

    [Fact]
    public async Task MarkReadIfVisible_RejectsForeign()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        svc.Notify("个人通知", "hello", userId: 42);
        await Task.Delay(700);

        var list = await svc.GetNotifications(42, role: "member");
        var notifId = list[0].Id;

        // 用户 1 试图标 userId=42 的通知 → 必须 false
        var ok = await svc.MarkReadIfVisible(notifId, userId: 1, role: "member");
        Assert.False(ok);

        // 用户 42 标自己的 → true
        var ok2 = await svc.MarkReadIfVisible(notifId, userId: 42, role: "member");
        Assert.True(ok2);
    }

    [Fact]
    public async Task UnreadCount_RespectsRoleFilter()
    {
        var db = CreateContext();
        var svc = CreateService(db);
        svc.Notify("全员 1", "");
        svc.Notify("全员 2", "");
        svc.Notify("管理员 1", "X", targetRole: "staff");
        svc.Notify("管理员 2", "Y", targetRole: "admin");
        await Task.Delay(800);

        var memberUnread = await svc.GetUnreadCount(1, role: "member");
        var staffUnread = await svc.GetUnreadCount(2, role: "部长");
        var adminUnread = await svc.GetUnreadCount(3, role: "admin");

        Assert.Equal(2, memberUnread);       // 只看 2 条全员
        Assert.Equal(3, staffUnread);        // 2 全员 + 1 staff
        Assert.Equal(4, adminUnread);        // 2 全员 + 1 staff + 1 admin
    }

    // ── SSE 订阅分发 ────────────────────────────────────────

    [Fact]
    public async Task Subscribe_DeliversVisibleNotifications()
    {
        var db = CreateContext();
        var svc = CreateService(db);

        var sub = svc.Subscribe(1, role: "member", out var reader);
        try
        {
            svc.Notify("成员事件", "hello");
            // 异步等 FanOut 完成
            var received = await ReadOneAsync(reader, "成员事件", TimeSpan.FromSeconds(2));
            Assert.Equal("成员事件", received);
        }
        finally { sub.Dispose(); }
    }

    [Fact]
    public async Task Subscribe_RespectsRoleFilter()
    {
        var db = CreateContext();
        var svc = CreateService(db);

        var memberSub = svc.Subscribe(1, role: "member", out var memberReader);
        var staffSub = svc.Subscribe(2, role: "admin", out var staffReader);
        try
        {
            svc.Notify("管理员通知", "采购", targetRole: "staff");
            // 成员不应收到(等 800ms 超时返回 null)
            var memberGot = await ReadOneAsync(memberReader, null, TimeSpan.FromMilliseconds(800));
            Assert.Null(memberGot);

            // 管理员应该收到
            var staffGot = await ReadOneAsync(staffReader, "管理员通知", TimeSpan.FromSeconds(2));
            Assert.Equal("管理员通知", staffGot);
        }
        finally { memberSub.Dispose(); staffSub.Dispose(); }
    }

    /// <summary>从 reader 读一条匹配 expectedTitle 的事件;timeout 内未匹配返回 null。
    /// 用 Task.WhenAny 避免 WaitToReadAsync 在 cancellation 时抛 OperationCanceledException。</summary>
    private static async Task<string?> ReadOneAsync(System.Threading.Channels.ChannelReader<TeamPortal.Data.Models.Notification> reader, string? expectedTitle, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var remaining = deadline - DateTime.UtcNow;
            var cts = new CancellationTokenSource(remaining);
            try
            {
                var has = await reader.WaitToReadAsync(cts.Token);
                if (!has) return null;
                if (reader.TryRead(out var n))
                {
                    if (expectedTitle is null) return n.Title;
                    if (n.Title == expectedTitle) return n.Title;
                }
            }
            catch (OperationCanceledException) { return null; }
        }
        return null;
    }
}