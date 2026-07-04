using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Centralized system logging service. Write to DB and console.
/// </summary>
public class LogService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LogService> _logger;

    public LogService(IServiceScopeFactory scopeFactory, ILogger<LogService> logger)
    {
        _scopeFactory = scopeFactory; _logger = logger;
    }

    public void Log(string level, string category, string message, string? detail = null, string? userName = null)
    {
        _logger.Log(level switch { "error" => LogLevel.Error, "warn" => LogLevel.Warning, _ => LogLevel.Information }, "[{Cat}] {Msg}", category, message);

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.SystemLogs.Add(new SystemLog { Level = level, Category = category, Message = message, Detail = detail, UserName = userName });
                await db.SaveChangesAsync();
            }
            catch { /* don't fail on logging */ }
        });
    }

    public void Info(string category, string message, string? detail = null, string? user = null) => Log("info", category, message, detail, user);
    public void Warn(string category, string message, string? detail = null, string? user = null) => Log("warn", category, message, detail, user);
    public void Error(string category, string message, string? detail = null, string? user = null) => Log("error", category, message, detail, user);

    public async Task<List<SystemLog>> GetLogs(string? level, string? category, int page = 1, int pageSize = 50)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.SystemLogs.AsQueryable();
        if (!string.IsNullOrEmpty(level)) query = query.Where(l => l.Level == level);
        if (!string.IsNullOrEmpty(category)) query = query.Where(l => l.Category == category);
        return await query.OrderByDescending(l => l.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken: CancellationToken.None);
    }
}
