using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Reliable centralized logging — channel-based async writes, auto-cleanup, stats.
/// SystemLog(请求/运行日志)与 OperationLog(业务操作审计)分离存储,各自独立 channel 批量写入。
/// </summary>
public class LogService : IDisposable
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LogService> _logger;
    private readonly SettingsService _settings;
    private readonly Channel<SystemLog> _channel;
    private readonly Channel<OperationLog> _auditChannel;
    private readonly CancellationTokenSource _cts = new();

    private static readonly JsonSerializerOptions AuditJsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public LogService(IServiceScopeFactory scopeFactory, ILogger<LogService> logger, SettingsService settings)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _settings = settings;
        _channel = Channel.CreateBounded<SystemLog>(new BoundedChannelOptions(5000)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });
        _auditChannel = Channel.CreateBounded<OperationLog>(new BoundedChannelOptions(5000)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });
        _ = ProcessChannel(_cts.Token);
        _ = ProcessAuditChannel(_cts.Token);
    }

    /// <summary>从请求上下文提取客户端 IP(供 Audit 使用,端点层调用)</summary>
    public static string? ClientIp(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString();

    /// <summary>Background consumer — writes logs to DB every 3 seconds.</summary>
    private async Task ProcessChannel(CancellationToken ct)
    {
        var batch = new List<SystemLog>(50);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                batch.Clear();
                // Drain up to 50 items with a 3-second flush timeout
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

                try
                {
                    while (batch.Count < 50)
                    {
                        var entry = await _channel.Reader.ReadAsync(linkedCts.Token);
                        batch.Add(entry);
                    }
                }
                catch (OperationCanceledException) { /* timeout — flush what we have */ }
            }
            catch (OperationCanceledException) { break; }

            if (batch.Count == 0) continue;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.SystemLogs.AddRange(batch);
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                foreach (var entry in batch)
                    _logger.LogError("[DB-LOG-FAIL] [{Cat}] {Msg}", entry.Category, entry.Message);
                _logger.LogError(ex, "LogService batch write failed");
            }
        }
    }

    /// <summary>Background consumer — writes audit logs to DB every 3 seconds.</summary>
    private async Task ProcessAuditChannel(CancellationToken ct)
    {
        var batch = new List<OperationLog>(50);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                batch.Clear();
                // Drain up to 50 items with a 3-second flush timeout
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

                try
                {
                    while (batch.Count < 50)
                    {
                        var entry = await _auditChannel.Reader.ReadAsync(linkedCts.Token);
                        batch.Add(entry);
                    }
                }
                catch (OperationCanceledException) { /* timeout — flush what we have */ }
            }
            catch (OperationCanceledException) { break; }

            if (batch.Count == 0) continue;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.OperationLogs.AddRange(batch);
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "LogService audit batch write failed ({Count} entries)", batch.Count);
            }
        }
    }

    public void Log(string level, string category, string message, string? detail = null, string? userName = null)
    {
        // Console mirror (always immediate)
        _logger.Log(level switch { "error" => LogLevel.Error, "warn" => LogLevel.Warning, _ => LogLevel.Information },
            "[{Cat}] {Msg}", category, message);

        // Async enqueue — non-blocking
        var entry = new SystemLog
        {
            Level = level, Category = category, Message = message,
            Detail = detail, UserName = userName, CreatedAt = DateTime.UtcNow
        };
        _channel.Writer.TryWrite(entry);
    }

    public void Info(string cat, string msg, string? detail = null, string? user = null) => Log("info", cat, msg, detail, user);
    public void Warn(string cat, string msg, string? detail = null, string? user = null) => Log("warn", cat, msg, detail, user);
    public void Error(string cat, string msg, string? detail = null, string? user = null) => Log("error", cat, msg, detail, user);

    // ── Audit(业务操作审计,独立于 SystemLog 存储)──
    /// <summary>
    /// 记录一条业务操作日志。data 会序列化为 JSON 存入 Data 字段(忽略 null 字段)。
    /// 失败场景同样调用 Audit,在 data 中携带 {"success":false,"error":"..."}。
    /// </summary>
    public void Audit(string action, string userName, string? targetType = null, string? targetId = null,
        object? data = null, string? ipAddress = null, int? userId = null)
    {
        var entry = new OperationLog
        {
            UserId = userId,
            UserName = userName,
            Action = action,
            TargetType = targetType,
            TargetId = targetId,
            Data = data is null ? null : JsonSerializer.Serialize(data, AuditJsonOptions),
            IpAddress = ipAddress,
            CreatedAt = DateTime.UtcNow
        };
        _auditChannel.Writer.TryWrite(entry);
    }

    // ── Query ──
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

    // ── Audit Query ──
    /// <summary>分页查询操作日志(按操作人/操作类型/时间范围筛选),返回条目与总数</summary>
    public async Task<(List<OperationLog> Items, int Total)> GetOperations(string? user = null, string? action = null,
        DateTime? from = null, DateTime? to = null, int page = 1, int pageSize = 50)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.OperationLogs.AsQueryable();
        if (!string.IsNullOrEmpty(user)) query = query.Where(o => o.UserName == user);
        if (!string.IsNullOrEmpty(action)) query = query.Where(o => o.Action == action);
        if (from.HasValue) query = query.Where(o => o.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(o => o.CreatedAt <= to.Value);
        var total = await query.CountAsync();
        var items = await query.OrderByDescending(o => o.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return (items, total);
    }

    /// <summary>操作日志 CSV 导出(时间,操作人,操作类型,目标类型,目标,数据,IP)</summary>
    public async Task<string> ExportOperationsCsv(string? user = null, string? action = null,
        DateTime? from = null, DateTime? to = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.OperationLogs.AsQueryable();
        if (!string.IsNullOrEmpty(user)) query = query.Where(o => o.UserName == user);
        if (!string.IsNullOrEmpty(action)) query = query.Where(o => o.Action == action);
        if (from.HasValue) query = query.Where(o => o.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(o => o.CreatedAt <= to.Value);
        var logs = await query.OrderByDescending(o => o.Id).Take(10000).ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("时间,操作人,操作类型,目标类型,目标,数据,IP");
        foreach (var o in logs)
            sb.AppendLine($"{o.CreatedAt:yyyy-MM-dd HH:mm:ss},{o.UserName},{o.Action},{o.TargetType ?? ""},{o.TargetId ?? ""},\"{o.Data?.Replace("\"", "\"\"") ?? ""}\",{o.IpAddress ?? ""}");
        return sb.ToString();
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
        return new { total, byAction, recent };
    }

    // ── Stats ──
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

        return new { total, errors24h, warns24h, recentErrors };
    }

    // ── Export ──
    public async Task<string> ExportCsv(string? level = null, DateTime? from = null, DateTime? to = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.SystemLogs.AsQueryable();
        if (!string.IsNullOrEmpty(level)) query = query.Where(l => l.Level == level);
        if (from.HasValue) query = query.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(l => l.CreatedAt <= to.Value);
        var logs = await query.OrderByDescending(l => l.Id).Take(10000).ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("时间,级别,分类,消息,用户");
        foreach (var l in logs)
            sb.AppendLine($"{l.CreatedAt:yyyy-MM-dd HH:mm:ss},{l.Level},{l.Category},\"{l.Message?.Replace("\"", "\"\"")}\",{l.UserName ?? ""}");
        return sb.ToString();
    }

    // ── Cleanup ──
    public async Task<int> CleanupOldLogs()
    {
        var days = await _settings.GetInt("System:LogRetentionDays", 90);
        var cutoff = DateTime.UtcNow.AddDays(-days);
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var deleted = await db.SystemLogs.Where(l => l.CreatedAt < cutoff).ExecuteDeleteAsync();
        if (deleted > 0)
            _logger.LogInformation("LogService: cleaned {Count} logs older than {Days}d", deleted, days);
        return deleted;
    }

    public async Task<int> ClearAllLogs()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var deleted = await db.SystemLogs.ExecuteDeleteAsync();
        _logger.LogInformation("LogService: cleared all {Count} logs", deleted);
        return deleted;
    }

    // ── Health ──
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

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}
