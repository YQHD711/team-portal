using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Reliable centralized logging — channel-based async writes, auto-cleanup, stats.
/// </summary>
public class LogService : IDisposable
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LogService> _logger;
    private readonly SettingsService _settings;
    private readonly Channel<SystemLog> _channel;
    private readonly CancellationTokenSource _cts = new();

    public LogService(IServiceScopeFactory scopeFactory, ILogger<LogService> logger, SettingsService settings)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _settings = settings;
        _channel = Channel.CreateBounded<SystemLog>(new BoundedChannelOptions(5000)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });
        _ = ProcessChannel(_cts.Token);
    }

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
