using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class BackupEndpoints
{
    public static void MapBackupEndpoints(this WebApplication app)
    {
        var backup = app.MapGroup("/api/admin/backup").RequireAuthorization("AdminOnly");

        // Trigger manual backup now
        backup.MapPost("/", async (BackupService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var ip = LogService.ClientIp(ctx);
            try
            {
                var path = await svc.CreateBackup("manual");
                log.Info("backup", $"Manual backup created by {user.Identity?.Name}: {Path.GetFileName(path)}");
                log.Audit("backup", user.Identity?.Name ?? "unknown", targetType: "backup", targetId: Path.GetFileName(path),
                    data: new { success = true }, ipAddress: ip);
                return Results.Ok(new { success = true, path, message = "备份完成" });
            }
            catch (Exception ex)
            {
                log.Warn("backup", $"Manual backup failed by {user.Identity?.Name}: {ex.Message}");
                log.Audit("backup", user.Identity?.Name ?? "unknown", targetType: "backup",
                    data: new { success = false, error = ex.Message }, ipAddress: ip);
                return Results.Problem(ex.Message, statusCode: 500);
            }
        });

        // List all backups
        backup.MapGet("/", (BackupService svc) =>
        {
            var backups = svc.ListBackups();
            return Results.Ok(backups);
        });

        // Backup stats + status
        backup.MapGet("/stats", (BackupService svc) =>
        {
            var stats = svc.GetStats();
            return Results.Ok(stats);
        });

        // Restore from a specific backup
        backup.MapPost("/restore", async (RestoreRequest req, BackupService svc,
            IHostApplicationLifetime lifetime, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.FileName))
                return Results.Problem("请指定备份文件名", statusCode: 400);

            // Double confirmation required
            if (!req.Confirm)
                return Results.Problem("请在请求中设置 confirm=true 确认恢复操作", statusCode: 400);

            var username = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            var ip = LogService.ClientIp(ctx);
            var success = await svc.Restore(req.FileName);

            if (!success)
            {
                log.Warn("backup", $"Restore failed by {username}: {req.FileName}");
                log.Audit("restore", username, targetType: "backup", targetId: req.FileName,
                    data: new { success = false, error = "备份文件不完整" }, ipAddress: ip);
                return Results.Problem("恢复失败，请检查备份文件是否完整", statusCode: 500);
            }

            log.Warn("backup", $"Database restored by {username}: {req.FileName}, app restarting");
            log.Audit("restore", username, targetType: "backup", targetId: req.FileName,
                data: new { success = true }, ipAddress: ip);

            // Trigger app restart after a brief delay (allow response to be sent)
            _ = Task.Run(async () =>
            {
                await Task.Delay(1000);
                lifetime.StopApplication();
            });

            return Results.Ok(new
            {
                success = true,
                message = "数据库已恢复，服务将在3秒后自动重启...",
                restartedBy = username,
            });
        });

        // Delete a backup
        backup.MapDelete("/{fileName}", (string fileName, BackupService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var ip = LogService.ClientIp(ctx);
            var ok = svc.DeleteBackup(fileName);
            if (!ok)
            {
                log.Warn("backup", $"Backup delete failed by {user.Identity?.Name}: {fileName}");
                log.Audit("delete", user.Identity?.Name ?? "unknown", targetType: "backup", targetId: fileName,
                    data: new { success = false, error = "备份文件不存在或为最新备份" }, ipAddress: ip);
                return Results.Problem("删除失败：备份文件不存在或为最新备份", statusCode: 400);
            }
            log.Info("backup", $"Backup deleted by {user.Identity?.Name}: {fileName}");
            log.Audit("delete", user.Identity?.Name ?? "unknown", targetType: "backup", targetId: fileName,
                data: new { success = true }, ipAddress: ip);
            return Results.Ok(new { success = true });
        });
    }
}

public record RestoreRequest(string FileName, bool Confirm);
