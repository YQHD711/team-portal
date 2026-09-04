using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class LogEndpoints
{
    public static void MapLogEndpoints(this WebApplication app)
    {
        var log = app.MapGroup("/api/admin/logs").RequireAuthorization("StaffOnly");

        // List logs with optional date range filter + keyword search
        log.MapGet("/", async (string? level, string? category, int? page, int? size, DateTime? from, DateTime? to, string? keyword, LogService svc) =>
        {
            var p = page ?? 1;
            var logs = await svc.GetLogs(level, category, p == 0 ? 1 : p, size ?? 50, from, to, keyword);
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

        // ── 操作日志(业务审计,与请求日志分离)──

        // 分页查询操作日志:可按操作人/操作类型/时间范围筛选
        log.MapGet("/operations", async (int? page, int? size, string? user, string? action, DateTime? from, DateTime? to, LogService svc) =>
        {
            var p = Math.Max(1, page ?? 1);
            var (items, total) = await svc.GetOperations(user, action, from, to, p, size ?? 50);
            return Results.Ok(new
            {
                total,
                items = items.Select(o => new
                {
                    o.Id, o.UserId, o.UserName, o.Action, o.TargetType, o.TargetId, o.Data, o.IpAddress, o.CreatedAt
                })
            });
        });

        // 操作日志统计:总数 + 按操作类型分组
        log.MapGet("/operations/stats", async (LogService svc) =>
        {
            var stats = await svc.GetOperationStats();
            return Results.Ok(stats);
        });

        // 操作日志 CSV 导出
        log.MapGet("/operations/export", async (string? user, string? action, DateTime? from, DateTime? to, LogService svc) =>
        {
            var csv = await svc.ExportOperationsCsv(user, action, from, to);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv", $"operations-{DateTime.UtcNow:yyyyMMdd}.csv");
        });

        // Export logs as CSV
        log.MapGet("/export", async (string? level, DateTime? from, DateTime? to, LogService svc) =>
        {
            var csv = await svc.ExportCsv(level, from, to);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv", $"logs-{DateTime.UtcNow:yyyyMMdd}.csv");
        });

        // Manual cleanup — force=true clears all, default keeps recent 90 days
        // Before cleanup, auto-archive logs as CSV to Baidu cloud
        log.MapPost("/cleanup", async (bool? force, LogService svc, BaiduNetdiskService baidu) =>
        {
            // 1. Export logs as CSV before deleting
            string? archivePath = null;
            try
            {
                if (await baidu.IsConfigured())
                {
                    var csv = await svc.ExportCsv(level: null, from: null, to: null);
                    var csvBytes = System.Text.Encoding.UTF8.GetBytes(csv);
                    var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                    var tmpPath = Path.Combine(Path.GetTempPath(), $"logs-archive-{timestamp}.csv");
                    await File.WriteAllBytesAsync(tmpPath, csvBytes);

                    var remotePath = $"{BaiduNetdiskService.RootDir}/system/logs/logs-{timestamp}.csv";
                    archivePath = await baidu.UploadFile(tmpPath, remotePath);
                    File.Delete(tmpPath);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[logs] Cloud archive skipped: {ex.Message}");
            }

            // 2. Run cleanup
            var deleted = force == true ? await svc.ClearAllLogs() : await svc.CleanupOldLogs();
            return Results.Ok(new { deleted, archivePath, message = archivePath is not null ? $"已清理 {deleted} 条日志，归档到 {archivePath}" : $"已清理 {deleted} 条日志" });
        });
    }
}
