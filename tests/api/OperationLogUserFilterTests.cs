using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 队员档案里的「操作日志」要按 userId 查。
///
/// 回归点：以前只能按 UserName 查。用户名是**可以被管理员改**的，
/// 改名之后按新名字查，这个人在改名之前的记录全部查不到——历史被一刀两断。
/// 用户 id 不会变，所以查"某人的历史"必须认 id。
/// </summary>
public class OperationLogUserFilterTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public OperationLogUserFilterTests()
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

    private LogService CreateService()
    {
        var scopes = new TestScopeFactory(_db);
        return new LogService(scopes, NullLogger<LogService>.Instance, new SettingsService(scopes));
    }

    /// <summary>造一条操作日志；UserName 可以故意与"当前"用户名不一致，模拟改名前后</summary>
    private void AddLog(int? userId, string userName, string action, string? targetId = null)
    {
        _db.OperationLogs.Add(new OperationLog
        {
            UserId = userId, UserName = userName, Action = action, TargetType = "material", TargetId = targetId,
            CreatedAt = DateTime.UtcNow,
        });
    }

    [Fact]
    public async Task GetOperations_ByUserId_ReturnsRecordsAcrossRename()
    {
        // 同一个人：先叫 alice 领用过桨叶，改名 bob 后又领用了一次
        AddLog(1, "alice", "checkout", "10");
        AddLog(1, "bob", "checkout", "11");
        AddLog(2, "carol", "checkout", "12");
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        var (items, total) = await svc.GetOperations(userId: 1);

        Assert.Equal(2, total);
        Assert.Equal(2, items.Count);
        // 改名前的记录必须还在
        Assert.Contains(items, o => o.UserName == "alice");
        Assert.Contains(items, o => o.UserName == "bob");
        // 别人的记录不能混进来
        Assert.DoesNotContain(items, o => o.UserName == "carol");
    }

    [Fact]
    public async Task GetOperations_ByUserName_StillWorksButMissesOldName()
    {
        // 对照：旧用法（按名字）仍然能用，但改名前的记录确实查不到 ——
        // 这正是要点 userId 过滤的原因，不是"顺手加的参数"
        AddLog(1, "alice", "checkout");
        AddLog(1, "bob", "checkout");
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        var (items, total) = await svc.GetOperations(user: "bob");

        Assert.Equal(1, total);
        Assert.Single(items);
        Assert.Equal("bob", items[0].UserName);
    }

    [Fact]
    public async Task GetOperations_UserId_TakesPrecedenceOverUserName()
    {
        AddLog(1, "alice", "checkout");
        AddLog(2, "bob", "checkout");
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        // 两个都传时以 id 为准，避免"名字改了但前端还传旧名字"这种组合出错
        var (items, total) = await svc.GetOperations(user: "bob", userId: 1);

        Assert.Equal(1, total);
        Assert.Equal("alice", items[0].UserName);
    }

    [Fact]
    public async Task GetOperations_UnknownUser_ReturnsEmptyNotEverything()
    {
        AddLog(1, "alice", "checkout");
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        var (items, total) = await svc.GetOperations(userId: 999);

        Assert.Equal(0, total);
        Assert.Empty(items);
    }

    [Fact]
    public async Task GetOperations_NoFilter_ReturnsAll()
    {
        AddLog(1, "alice", "checkout");
        AddLog(2, "bob", "checkin");
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        var (items, total) = await svc.GetOperations();

        Assert.Equal(2, total);
        Assert.Equal(2, items.Count);
    }
}
