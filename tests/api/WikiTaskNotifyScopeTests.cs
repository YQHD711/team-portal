using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// Wiki 任务完成通知的**收件人范围**。
///
/// 回归的原始缺陷：worker 里是无参 Notify(...) → UserId 与 TargetRole 都是 null，
/// 按既有可见性判定等于「只要有账号就收得到」，于是**别的部门队员也会收到
/// 不相干项目的完成通知**。
///
/// 这里刻意不给通知加"部门作用域"字段：可见性判定散在 GetNotifications /
/// GetUnreadCount / MarkAllRead / IsVisibleTo / SSE fan-out 共 6 处，
/// 加字段意味着 6 处都要同步改，漏一处就是一次越权泄露。
/// 改为复用既有的 UserId 定向。
/// </summary>
public class WikiTaskNotifyScopeTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public WikiTaskNotifyScopeTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
    }

    /// <summary>飞训部 2 人(a、b) + 电子部 1 人(c)。</summary>
    private async Task<(User a, User b, User c)> SeedAsync()
    {
        var flight = new Department { Name = "飞训部" };
        var elec = new Department { Name = "电子部" };
        _db.Departments.AddRange(flight, elec);
        await _db.SaveChangesAsync();
        var a = new User { Username = "a", PasswordHash = "x", Role = "member", DepartmentId = flight.Id };
        var b = new User { Username = "b", PasswordHash = "x", Role = "部长", DepartmentId = flight.Id };
        var c = new User { Username = "c", PasswordHash = "x", Role = "member", DepartmentId = elec.Id };
        _db.Users.AddRange(a, b, c);
        await _db.SaveChangesAsync();
        return (a, b, c);
    }

    private static WikiTask Task(string visibility, string? targetFolder, int userId)
        => new() { Id = "t1", Type = "git", ProjectName = "ardupilot", Visibility = visibility, TargetFolder = targetFolder ?? "", UserId = userId };

    [Fact]
    public async Task Public_IsBroadcast()
    {
        await SeedAsync();

        var recipients = await WikiProcessingWorker.RecipientsAsync(_db, Task("public", "公共", 1));

        Assert.Null(recipients);   // null = 广播给所有人
    }

    [Fact]
    public async Task Department_OnlyReachesThatDepartment()
    {
        var (a, b, c) = await SeedAsync();

        var recipients = await WikiProcessingWorker.RecipientsAsync(_db, Task("department", "飞训部", a.Id));

        Assert.NotNull(recipients);
        Assert.Contains(a.Id, recipients!);
        Assert.Contains(b.Id, recipients!);            // 同部门的部长也收到
        Assert.DoesNotContain(c.Id, recipients!);      // 别的部门收不到 ← 就是这个缺陷
    }

    [Fact]
    public async Task Department_RequesterFromAnotherDepartment_StillNotified()
    {
        var (_, _, c) = await SeedAsync();
        // c 是电子部的人，却发起了一个"飞训部可见"的项目：他自己也该收到
        var recipients = await WikiProcessingWorker.RecipientsAsync(_db, Task("department", "飞训部", c.Id));

        Assert.NotNull(recipients);
        Assert.Contains(c.Id, recipients!);
    }

    [Fact]
    public async Task Personal_OnlyReachesOwner()
    {
        var (a, b, c) = await SeedAsync();

        var recipients = await WikiProcessingWorker.RecipientsAsync(_db, Task("personal", "飞训部", a.Id));

        Assert.Equal([a.Id], recipients);
        Assert.DoesNotContain(b.Id, recipients!);
        Assert.DoesNotContain(c.Id, recipients!);
    }

    [Fact]
    public async Task UnknownDepartment_FallsBackToRequesterOnly()
    {
        var (a, _, _) = await SeedAsync();

        var recipients = await WikiProcessingWorker.RecipientsAsync(_db, Task("department", "不存在的部门", a.Id));

        Assert.Equal([a.Id], recipients);
    }

    [Fact]
    public async Task Recipients_AreNotVisibleToOtherDepartments_ByExistingRule()
    {
        // 端到端语义确认：按上面的收件人建通知后，别的部门的人确实看不到
        var (a, _, c) = await SeedAsync();
        var task = Task("department", "飞训部", a.Id);
        var recipients = (await WikiProcessingWorker.RecipientsAsync(_db, task))!;

        var notification = new Notification
        {
            Title = "Wiki 生成完成", Message = task.ProjectName,
            Link = $"/wiki/{task.Id}", UserId = recipients[0],
        };

        Assert.True(NotificationService.IsVisibleTo(notification, a.Id, "member"));
        Assert.False(NotificationService.IsVisibleTo(notification, c.Id, "member"));
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }
}
