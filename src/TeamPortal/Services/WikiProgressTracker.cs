using System.Collections.Concurrent;

namespace TeamPortal.Services;

/// <summary>某个 Wiki 任务的实时阶段进度。Total=0 表示该阶段没有可数的单元（显示不确定态）。</summary>
public record WikiProgress(string Stage, int Done, int Total, string? Note, DateTime UpdatedAt);

/// <summary>
/// Wiki 生成进度（进程内存，单例）。
///
/// 为什么不写库：文档是并行生成的（ParallelCount 个并发），往同一个 scoped DbContext 里
/// 并发 SaveChanges 不安全；进度本身也是易失数据，重启丢失可接受（任务会重新处理）。
/// </summary>
public class WikiProgressTracker
{
    private readonly ConcurrentDictionary<string, WikiProgress> _byTask = new();
    private static readonly TimeSpan Retain = TimeSpan.FromHours(6);

    /// <summary>记录/覆盖某任务的进度（可被并行调用）。</summary>
    public void Set(string taskId, string stage, int done, int total, string? note = null)
    {
        if (string.IsNullOrEmpty(taskId)) return;
        _byTask[taskId] = new WikiProgress(stage, done, Math.Max(0, total), note, DateTime.UtcNow);
        if (_byTask.Count > 200) Purge();
    }

    public WikiProgress? Get(string taskId) => _byTask.TryGetValue(taskId, out var p) ? p : null;

    /// <summary>移除任务（删除任务时调用，避免残留）。</summary>
    public void Clear(string taskId) => _byTask.TryRemove(taskId, out _);

    /// <summary>清掉过老的条目：已完成的任务进度没有长期保留的价值。
    /// now 可注入，便于测试过期行为。</summary>
    public void Purge(DateTime? now = null)
    {
        var cutoff = (now ?? DateTime.UtcNow) - Retain;
        foreach (var (id, p) in _byTask)
            if (p.UpdatedAt < cutoff) _byTask.TryRemove(id, out _);
    }
}
