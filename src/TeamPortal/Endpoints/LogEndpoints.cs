using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class LogEndpoints
{
    public static void MapLogEndpoints(this WebApplication app)
    {
        var log = app.MapGroup("/api/admin/logs").RequireAuthorization("AdminOnly");

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

        // 分页查询操作日志:操作人/动作/目标类型+ID/data 关键词/时间范围筛选
        log.MapGet("/operations", async (int? page, int? size, string? user, string? action, string? targetType, string? targetId, string? q, DateTime? from, DateTime? to, LogService svc) =>
        {
            var p = Math.Max(1, page ?? 1);
            var (items, total) = await svc.GetOperations(user, action, targetType, targetId, q, from, to, p, size ?? 50);
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
        log.MapPost("/cleanup", async (bool? force, LogService svc, BaiduNetdiskService baidu,
            ClaimsPrincipal user, HttpContext ctx) =>
        {
            var actor = user.Identity?.Name ?? "unknown";
            var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            string? sysArchive = null, opArchive = null;

            // 1. Archive logs as CSV before deleting
            // 操作日志(审计)同样归档:force 清理会把审计一并删除
            try
            {
                if (await baidu.IsConfigured())
                {
                    sysArchive = await ArchiveCsv(baidu, await svc.ExportCsv(level: null, from: null, to: null),
                        $"logs-{timestamp}.csv", "system/logs");
                    opArchive = await ArchiveCsv(baidu, await svc.ExportOperationsCsv(),
                        $"operations-{timestamp}.csv", "system/operation-logs");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[logs] Cloud archive skipped: {ex.Message}");
            }

            // 2. Run cleanup
            var deleted = force == true ? await svc.ClearAllLogs() : await svc.CleanupOldLogs();

            // 3. 清理动作本身必须留痕,且写在删除之后 —— force 清理会删掉此刻之前的全部审计
            svc.Audit("cleanup-logs", actor, targetType: "log", data: new
            {
                force = force == true,
                deleted,
                systemArchive = sysArchive,
                operationArchive = opArchive
            }, ipAddress: LogService.ClientIp(ctx));

            var message = sysArchive is not null
                ? $"已清理 {deleted} 条日志，归档到 {sysArchive}"
                : $"已清理 {deleted} 条日志";
            return Results.Ok(new { deleted, archivePath = sysArchive, operationArchive = opArchive, message });
        });
    }

    /// <summary>把 CSV 写入临时文件并上传到网盘归档目录,返回远端路径(临时文件必定清理)。</summary>
    private static async Task<string> ArchiveCsv(BaiduNetdiskService baidu, string csv, string fileName, string folder)
    {
        var tmpPath = Path.Combine(Path.GetTempPath(), $"logs-archive-{fileName}");
        await File.WriteAllBytesAsync(tmpPath, System.Text.Encoding.UTF8.GetBytes(csv));
        try
        {
            return await baidu.UploadFile(tmpPath, $"{BaiduNetdiskService.RootDir}/{folder}/{fileName}");
        }
        finally
        {
            File.Delete(tmpPath);
        }
    }
}
