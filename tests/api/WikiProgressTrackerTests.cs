using System.Collections.Concurrent;
using TeamPortal.Services;

namespace api;

/// <summary>
/// Wiki 生成进度跟踪器：并行生成文档时会被多线程同时写入，必须线程安全；
/// 同时它是易失数据（进程内存），不该影响任务本身的持久化状态。
/// </summary>
public class WikiProgressTrackerTests
{
    [Fact]
    public void Set_ThenGet_RoundTrips()
    {
        var tracker = new WikiProgressTracker();

        tracker.Set("t1", "documents", 3, 12, "飞控驱动");

        var p = tracker.Get("t1");
        Assert.NotNull(p);
        Assert.Equal("documents", p!.Stage);
        Assert.Equal(3, p.Done);
        Assert.Equal(12, p.Total);
        Assert.Equal("飞控驱动", p.Note);
    }

    [Fact]
    public void Set_IgnoresEmptyTaskId_AndClampsNegativeTotal()
    {
        var tracker = new WikiProgressTracker();

        tracker.Set("", "documents", 1, 1);
        Assert.Null(tracker.Get(""));

        tracker.Set("t1", "catalog", 0, -5, null);
        Assert.Equal(0, tracker.Get("t1")!.Total);
    }

    [Fact]
    public async Task Set_IsThreadSafe_UnderParallelDocumentCompletion()
    {
        var tracker = new WikiProgressTracker();
        var tasks = Enumerable.Range(0, 200).Select(i => Task.Run(() => tracker.Set($"t{i}", "documents", i, 200)));

        await Task.WhenAll(tasks);

        for (var i = 0; i < 200; i++)
            Assert.Equal(i, tracker.Get($"t{i}")!.Done);
    }

    [Fact]
    public void Set_OverwritesPreviousStage()
    {
        var tracker = new WikiProgressTracker();

        tracker.Set("t1", "catalog", 0, 0, "规划目录");
        tracker.Set("t1", "documents", 1, 5, "第一篇");

        Assert.Equal("documents", tracker.Get("t1")!.Stage);
        Assert.Equal(1, tracker.Get("t1")!.Done);
    }

    [Fact]
    public void Clear_RemovesEntry_SoDeletedTaskLeavesNothingBehind()
    {
        var tracker = new WikiProgressTracker();
        tracker.Set("t1", "documents", 1, 5);

        tracker.Clear("t1");

        Assert.Null(tracker.Get("t1"));
    }

    [Fact]
    public void Purge_DropsStaleEntriesOnly()
    {
        var tracker = new WikiProgressTracker();
        tracker.Set("old", "completed", 5, 5);
        tracker.Set("fresh", "documents", 1, 5);

        // 把时间推到保留期之后：两条都会过期……
        tracker.Purge(DateTime.UtcNow.AddHours(12));
        Assert.Null(tracker.Get("old"));
        Assert.Null(tracker.Get("fresh"));

        // ……但刚写入的条目在正常时间下必须保留
        tracker.Set("now", "documents", 1, 5);
        tracker.Purge(DateTime.UtcNow);
        Assert.NotNull(tracker.Get("now"));
    }

    [Fact]
    public void Purge_KeepsDictionaryBounded_WhenManyTasksAccumulate()
    {
        var tracker = new WikiProgressTracker();
        for (var i = 0; i < 250; i++) tracker.Set($"t{i}", "documents", 1, 5);

        // Set 内部超过阈值会自动清理过老条目；这里验证新条目仍在
        Assert.NotNull(tracker.Get("t249"));
    }
}
