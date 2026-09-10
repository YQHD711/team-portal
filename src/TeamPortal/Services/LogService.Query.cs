using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>LogService — 查询与统计。</summary>
public partial class LogService
{
    public async Task<List<SystemLog>> GetLogs(string? level, string? category, int page = 1, int pageSize = 50,
        DateTime? from = null, DateTime? to = null, string? keyword = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.SystemLogs.AsQueryable();
        if (!string.IsNullOrEmpty(level)) query = query.Where(l => l.Level == level);
        if (!string.IsNullOrEmpty(category)) query = query.Where(l => l.Category == category);
        if (from.HasValue) query = query.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(l => l.CreatedAt <= to.Value);
        if (!string.IsNullOrEmpty(keyword))
            query = query.Where(l => (l.Message != null && l.Message.Contains(keyword)) || (l.Detail != null && l.Detail.Contains(keyword)));
        return await query.OrderByDescending(l => l.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
    }

    /// <summary>分页查询操作日志。可按 操作人/动作/目标类型+ID/data 关键词/时间 过滤;返回前低频惰性删超期行。</summary>
    public async Task<(List<OperationLog> Items, int Total)> GetOperations(string? user = null, string? action = null,
        string? targetType = null, string? targetId = null, string? keyword = null,
        DateTime? from = null, DateTime? to = null, int page = 1, int pageSize = 50)
    {
        await LazyPruneOperationLogs();
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.OperationLogs.AsQueryable();
        if (!string.IsNullOrEmpty(user)) query = query.Where(o => o.UserName == user);
        if (!string.IsNullOrEmpty(action)) query = query.Where(o => o.Action == action);
        if (!string.IsNullOrEmpty(targetType)) query = query.Where(o => o.TargetType == targetType);
        if (!string.IsNullOrEmpty(targetId)) query = query.Where(o => o.TargetId != null && o.TargetId.Contains(targetId));
        if (!string.IsNullOrEmpty(keyword)) query = query.Where(o => o.Data != null && o.Data.Contains(keyword));
        if (from.HasValue) query = query.Where(o => o.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(o => o.CreatedAt <= to.Value);
        var total = await query.CountAsync();
        var items = await query.OrderByDescending(o => o.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return (items, total);
    }

    /// <summary>操作日志统计:总数 + 按操作类型分组计数</summary>
    public async Task<object> GetOperationStats()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var total = await db.OperationLogs.CountAsync();
        var byAction = await db.OperationLogs
            .GroupBy(o => o.Action)
            .Select(g => new { action = g.Key, count = g.Count() })
            .OrderByDescending(x => x.count)
            .ToListAsync();
        var recent = await db.OperationLogs
            .OrderByDescending(o => o.Id).Take(10)
            .Select(o => new { o.UserName, o.Action, o.TargetId, o.CreatedAt })
            .ToListAsync();
        var (sysPending, sysDropped, auditPending, auditDropped) = GetChannelStats();
        return new
        {
            total, byAction, recent,
            auditPending, auditDropped,
            sysPending, sysDropped
        };
    }

    public async Task<object> GetStats()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;

        var total = await db.SystemLogs.CountAsync();
        var errors24h = await db.SystemLogs.CountAsync(l => l.Level == "error" && l.CreatedAt >= now.AddHours(-24));
        var warns24h = await db.SystemLogs.CountAsync(l => l.Level == "warn" && l.CreatedAt >= now.AddHours(-24));
        var recentErrors = await db.SystemLogs
            .Where(l => l.Level == "error")
            .OrderByDescending(l => l.Id).Take(5)
            .Select(l => new { l.Category, l.Message, l.CreatedAt })
            .ToListAsync();

        return new { total, errors24h, warns24h, recentErrors, pendingWrites = _channel.Reader.Count, dropped = Interlocked.Read(ref _sysDropped) };
    }

    public async Task<object> GetHealth()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        try
        {
            // Quick DB connectivity test
            await db.Users.CountAsync();
            var pendingWrites = _channel.Reader.Count;
            return new { db = "ok", pendingWrites, status = pendingWrites > 1000 ? "degraded" : "healthy" };
        }
        catch (Exception ex)
        {
            return new { db = "error", error = ex.Message, status = "unhealthy" };
        }
    }
}
