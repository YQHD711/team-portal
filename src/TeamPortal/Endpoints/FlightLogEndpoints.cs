using System.Security.Claims;
using System.Text.Json;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class FlightLogEndpoints
{
    private static string GetDataDir() =>
        Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "flightlogs"));

    public static void MapFlightLogEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/flightlogs").RequireAuthorization();

        group.MapGet("/", async (FlightLogService svc) =>
        {
            var result = await svc.ListLogs();
            return result is not null ? Results.Ok(result) : Results.Problem("Service unavailable", statusCode: 503);
        });

        group.MapGet("/{filename}", (string filename, FlightLogService svc) =>
        {
            var file = svc.GetFile(filename);
            if (file is null || file.Value.Bytes is null)
                return Results.Problem("File not found", statusCode: 404);
            return Results.File(file.Value.Bytes, file.Value.ContentType ?? "application/octet-stream", filename);
        });

        // Delete a flight log file (admin only; hard delete + audit)
        group.MapDelete("/{filename}", async (string filename, FlightLogService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var ok = svc.DeleteFile(filename);
            if (!ok) return Results.Problem("File not found", statusCode: 404);
            var actor = user.Identity?.Name ?? "unknown";
            log.Warn("flightlog", $"Flight log deleted: {filename} by {actor}");
            log.Audit("delete", actor, targetType: "flightlog", targetId: filename,
                data: new { filename }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = true });
        }).RequireAuthorization("AdminOnly");

        // Upload .tlog/.bin file — save locally + sync to Baidu cloud
        group.MapPost("/upload", async (IFormFile file, BaiduNetdiskService baidu, FlightLogService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);

            // 文件名是客户端可控的:先取 basename,再经 ResolveSafePath 校验(旧实现直接
            // Path.Combine(dataDir, file.FileName),可传 ..\..\..\x.tlog 写到任意目录)
            var safeName = Path.GetFileName(file.FileName);
            var ext = Path.GetExtension(safeName).ToLowerInvariant();
            if (ext is not ".tlog" and not ".bin")
                return Results.Problem("Only .tlog and .bin files are accepted", statusCode: 400);

            var localPath = svc.ResolveSafePath(safeName);
            if (localPath is null) return Results.Problem("非法文件名", statusCode: 400);

            var actor = user.Identity?.Name ?? "unknown";
            var dataDir = GetDataDir();
            Directory.CreateDirectory(dataDir);

            await using (var stream = File.Create(localPath))
                await file.CopyToAsync(stream);

            string? cloudPath = null;
            if (await baidu.IsConfigured())
            {
                try
                {
                    var remotePath = $"{BaiduNetdiskService.RootDir}/user-data/flight-logs/{safeName}";
                    cloudPath = await baidu.UploadFile(localPath, remotePath);
                }
                catch (Exception ex) { log.Warn("flightlog", $"Cloud sync failed for {safeName}: {ex.Message}"); }
            }

            log.Info("flightlog", $"Flight log uploaded: {safeName} ({file.Length} bytes) by {actor}");
            notify.Notify("飞行日志已上传", $"{actor} 上传了 {safeName}", "/flightlog", targetRole: "staff");
            return Results.Ok(new { success = true, fileName = safeName, localPath, cloudPath });
        }).DisableAntiforgery();

        // Get flight metadata (sidecar JSON)
        group.MapGet("/{filename}/meta", (string filename, FlightLogService svc) =>
        {
            var basePath = svc.ResolveSafePath(filename);
            if (basePath is null) return Results.Problem("非法文件名", statusCode: 400);
            var jsonPath = basePath + ".meta.json";
            if (!File.Exists(jsonPath)) return Results.Ok(new { });
            var json = File.ReadAllText(jsonPath);
            return Results.Ok(JsonSerializer.Deserialize<object>(json) ?? new { });
        });

        // Save flight metadata
        group.MapPut("/{filename}/meta", async (string filename, HttpRequest req, FlightLogService svc, ClaimsPrincipal user, LogService log) =>
        {
            var basePath = svc.ResolveSafePath(filename);
            if (basePath is null) return Results.Problem("非法文件名", statusCode: 400);
            var jsonPath = basePath + ".meta.json";
            using var reader = new StreamReader(req.Body);
            var body = await reader.ReadToEndAsync();
            try { JsonDocument.Parse(body); } catch { return Results.Problem("Invalid JSON", statusCode: 400); }
            await File.WriteAllTextAsync(jsonPath, body);
            log.Info("flightlog", $"Flight meta saved: {filename} by {user.Identity?.Name ?? "unknown"}");
            return Results.Ok(new { success = true });
        });
    }
}
