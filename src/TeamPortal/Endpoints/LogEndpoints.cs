using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class LogEndpoints
{
    public static void MapLogEndpoints(this WebApplication app)
    {
        var log = app.MapGroup("/api/admin/logs").RequireAuthorization("StaffOnly");

        // List logs with optional date range filter
        log.MapGet("/", async (string? level, string? category, int page, DateTime? from, DateTime? to, LogService svc) =>
        {
            var logs = await svc.GetLogs(level, category, page == 0 ? 1 : page, 50, from, to);
            return Results.Ok(logs.Select(l => new
            {
                l.Id, l.Level, l.Category, l.Message, l.Detail, l.UserName, l.CreatedAt
            }));
        });

        // Log statistics
        log.MapGet("/stats", async (LogService svc) =>
        {
            var stats = await svc.GetStats();
            return Results.Ok(stats);
        });

        // Export logs as CSV
        log.MapGet("/export", async (string? level, DateTime? from, DateTime? to, LogService svc) =>
        {
            var csv = await svc.ExportCsv(level, from, to);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv", $"logs-{DateTime.UtcNow:yyyyMMdd}.csv");
        });

        // Manual cleanup — force=true clears all, default keeps recent 90 days
        log.MapPost("/cleanup", async (bool? force, LogService svc) =>
        {
            var deleted = force == true ? await svc.ClearAllLogs() : await svc.CleanupOldLogs();
            return Results.Ok(new { deleted, message = $"已清理 {deleted} 条日志" });
        });

        // System health check
        log.MapGet("/health", async (LogService svc) =>
        {
            var health = await svc.GetHealth();
            return Results.Ok(health);
        });
    }
}
