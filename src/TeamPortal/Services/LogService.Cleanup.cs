using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>清理结果：两表各删除的行数</summary>
public record LogCleanupResult(int SystemDeleted, int OperationDeleted)
{
    public int Total => SystemDeleted + OperationDeleted;
}

/// <summary>LogService — 保留期清理。</summary>
public partial class LogService
{
    /// <summary>
    /// 按保留期清理两表：请求日志(System:LogRetentionDays)与操作日志(System:OperationRetentionDays)。
    /// <para>
    /// 只删除「已成功归档」的行 —— 即 Id ≤ 对应表的 archivedMaxId 且已超期。
    /// 传 null 表示该表本次未归档（或归档失败），此时**不删除**该表任何行，避免归档缺口变成永久数据丢失。
    /// </para>
    /// </summary>
    public async Task<LogCleanupResult> CleanupOldLogs(long? archivedSystemMaxId, long? archivedOperationMaxId)
    {
        var sysDays = await _settings.GetInt("System:LogRetentionDays", 90);
        var opDays = await _settings.GetInt("System:OperationLogRetentionDays", 180);
        var now = DateTime.UtcNow;
        var sysCutoff = now.AddDays(-sysDays);
        var opCutoff = now.AddDays(-opDays);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var sysDeleted = archivedSystemMaxId.HasValue
            ? await db.SystemLogs.Where(l => l.CreatedAt < sysCutoff && l.Id <= archivedSystemMaxId.Value).ExecuteDeleteAsync()
            : 0;
        var opDeleted = archivedOperationMaxId.HasValue
            ? await db.OperationLogs.Where(o => o.CreatedAt < opCutoff && o.Id <= archivedOperationMaxId.Value).ExecuteDeleteAsync()
            : 0;

        if (sysDeleted + opDeleted > 0)
            _logger.LogInformation("LogService: cleaned {Sys} sys logs >{SD}d & {Op} op logs >{OD}d", sysDeleted, sysDays, opDeleted, opDays);
        return new LogCleanupResult(sysDeleted, opDeleted);
    }

    /// <summary>低频惰性删操作日志超期行(避免无人点清理时无限膨胀)。约每 10 分钟最多一次。</summary>
    public async Task<int> LazyPruneOperationLogs()
    {
        const long intervalTicks = 10 * 60 * 1000; // 10 分钟
        if (Environment.TickCount64 - _lastOpPruneTicks < intervalTicks) return 0;
        _lastOpPruneTicks = Environment.TickCount64;
        var days = await _settings.GetInt("System:OperationLogRetentionDays", 180);
        var cutoff = DateTime.UtcNow.AddDays(-days);
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var deleted = await db.OperationLogs.Where(o => o.CreatedAt < cutoff).ExecuteDeleteAsync();
        if (deleted > 0) _logger.LogInformation("LogService: lazy pruned {Count} operation logs >{D}d", deleted, days);
        return deleted;
    }

    public async Task<int> ClearAllLogs()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sys = await db.SystemLogs.ExecuteDeleteAsync();
        var op = await db.OperationLogs.ExecuteDeleteAsync();
        _logger.LogInformation("LogService: cleared all {Sys} sys logs & {Op} op logs", sys, op);
        return sys + op;
    }
}
