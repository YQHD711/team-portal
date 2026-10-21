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

        // 分页查询操作日志:操作人/操作人ID/动作/目标类型+ID/data 关键词/时间范围筛选
        log.MapGet("/operations", async (int? page, int? size, string? user, int? userId, string? action, string? targetType, string? targetId, string? q, DateTime? from, DateTime? to, LogService svc) =>
        {
            var p = Math.Max(1, page ?? 1);
            var (items, total) = await svc.GetOperations(user, userId, action, targetType, targetId, q, from, to, p, size ?? 50);
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

        // Manual cleanup（append-only 加固，H-04）：
        //  - 默认：只删「超期且已归档覆盖」的行；本次归档失败 → 一行都不删。
        //  - force=true：清空全部，但同样必须**先成功归档**；归档失败直接 500 拒绝清理。
        //  - 完成后把 {count, table, maxId, sha256} 回执写入 SystemSettings(Audit:LastCleanup)，不随日志清理删除。
        log.MapPost("/cleanup", async (bool? force, LogService svc, LogArchiver archiver,
            ClaimsPrincipal user, HttpContext ctx) =>
        {
            var actor = user.Identity?.Name ?? "unknown";
            var forced = force == true;
            var ip = LogService.ClientIp(ctx);

            LogArchiveOutcome outcome;
            try
            {
                outcome = forced ? await archiver.ArchiveAllAsync() : await archiver.ArchiveExpiredAsync();
            }
            catch (Exception ex)
            {
                // 归档失败 → 拒绝清理：宁可留着日志，也不允许"删了却没归档"
                svc.Audit("cleanup-logs", actor, targetType: "log",
                    data: new { success = false, forced, error = ex.Message }, ipAddress: ip);
                return Results.Problem($"归档失败，已拒绝清理（日志未删除）：{ex.Message}", statusCode: 500);
            }

            // 清理本身会写持久回执（Audit:LastCleanup：count/table/maxId/sha256），归档失败时不会走到这里
            var result = forced
                ? await svc.ClearArchivedLogs(outcome.System.MaxId, outcome.Operation.MaxId,
                    outcome.System.Path, outcome.Operation.Path, actor)
                : await svc.CleanupOldLogs(outcome.System.MaxId, outcome.Operation.MaxId,
                    outcome.System.Path, outcome.Operation.Path, actor);

            // 清理动作本身必须留痕，且写在删除之后（下次 force 清理会删掉这条审计，但回执仍在 SystemSettings）
            svc.Audit("cleanup-logs", actor, targetType: "log", data: new
            {
                forced,
                deleted = result.Total,
                systemDeleted = result.SystemDeleted,
                operationDeleted = result.OperationDeleted,
                systemArchive = outcome.System.Path,
                operationArchive = outcome.Operation.Path,
                systemRemote = outcome.SystemRemote,
                operationRemote = outcome.OperationRemote,
                systemMaxId = outcome.System.MaxId,
                operationMaxId = outcome.Operation.MaxId,
            }, ipAddress: ip);

            var message = forced
                ? $"已归档并清除 {result.Total} 条日志（归档：{outcome.System.Path} / {outcome.Operation.Path}）"
                : $"已清理 {result.Total} 条超期日志（仅含已归档行）";
            return Results.Ok(new
            {
                deleted = result.Total,
                systemDeleted = result.SystemDeleted,
                operationDeleted = result.OperationDeleted,
                forced,
                systemMaxId = outcome.System.MaxId,
                operationMaxId = outcome.Operation.MaxId,
                message,
            });
        });
    }
}
