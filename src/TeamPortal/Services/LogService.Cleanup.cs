using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>LogService — 保留期清理。</summary>
public partial class LogService
{
    /// <summary>按保留期清理两表:请求日志(LogRetentionDays)与操作日志(OperationLogRetentionDays,默认180)</summary>
    public async Task<int> CleanupOldLogs()
    {
        var sysDays = await _settings.GetInt("System:LogRetentionDays", 90);
        var opDays = await _settings.GetInt("System:OperationLogRetentionDays", 180);
        var now = DateTime.UtcNow;
        var sysCutoff = now.AddDays(-sysDays);
        var opCutoff = now.AddDays(-opDays);
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var deleted = await db.SystemLogs.Where(l => l.CreatedAt < sysCutoff).ExecuteDeleteAsync();
        var opDeleted = await db.OperationLogs.Where(o => o.CreatedAt < opCutoff).ExecuteDeleteAsync();
        if (deleted + opDeleted > 0)
            _logger.LogInformation("LogService: cleaned {Sys} sys logs >{SD}d & {Op} op logs >{OD}d", deleted, sysDays, opDeleted, opDays);
        return deleted + opDeleted;
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
