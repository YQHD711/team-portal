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
        // 先归档再清理：只有成功落盘（本地 CSV，网盘已配置时再传一份）的行才允许删除，
        // 归档失败则对应表跳过清理 —— 避免「删掉了却没归档」造成审计数据永久丢失。
        log.MapPost("/cleanup", async (bool? force, LogService svc, LogArchiver archiver,
            ClaimsPrincipal user, HttpContext ctx) =>
        {
            var actor = user.Identity?.Name ?? "unknown";
            LogArchiveOutcome? outcome = null;
            string? archiveError = null;

            try { outcome = await archiver.ArchiveExpiredAsync(); }
            catch (Exception ex) { archiveError = ex.Message; }

            var deleted = force == true
                ? await svc.ClearAllLogs()   // 前端已二次确认：明确要求清空，归档失败也照常执行
                : (await svc.CleanupOldLogs(outcome?.System.MaxId, outcome?.Operation.MaxId)).Total;

            // 清理动作本身必须留痕,且写在删除之后 —— force 清理会删掉此刻之前的全部审计
            svc.Audit("cleanup-logs", actor, targetType: "log", data: new
            {
                force = force == true,
                deleted,
                systemArchive = outcome?.System.Path,
                systemArchived = outcome?.System.Count ?? 0,
                systemRemote = outcome?.SystemRemote,
                operationArchive = outcome?.Operation.Path,
                operationArchived = outcome?.Operation.Count ?? 0,
                operationRemote = outcome?.OperationRemote,
                archiveError
            }, ipAddress: LogService.ClientIp(ctx));

            var message = archiveError is not null
                ? $"已清理 {deleted} 条日志（归档失败，未归档的表已跳过：{archiveError}）"
                : $"已清理 {deleted} 条日志（归档请求日志 {outcome?.System.Count ?? 0} 条 / 操作日志 {outcome?.Operation.Count ?? 0} 条）";
            return Results.Ok(new
            {
                deleted,
                archiveError,
                archivePath = outcome?.SystemRemote ?? outcome?.System.Path,
                operationArchive = outcome?.OperationRemote ?? outcome?.Operation.Path,
                message
            });
        });
    }
}
