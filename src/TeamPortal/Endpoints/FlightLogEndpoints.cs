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

        group.MapGet("/{filename}", async (string filename, FlightLogService svc) =>
        {
            var result = await svc.ParseLog(filename);
            return result is not null ? Results.Ok(result) : Results.Problem("Parse failed", statusCode: 503);
        });

        // Upload .tlog/.bin file — save locally + sync to Baidu cloud
        group.MapPost("/upload", async (IFormFile file, BaiduNetdiskService baidu, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (ext is not ".tlog" and not ".bin")
                return Results.Problem("Only .tlog and .bin files are accepted", statusCode: 400);

            var actor = user.Identity?.Name ?? "unknown";
            var dataDir = GetDataDir();
            Directory.CreateDirectory(dataDir);
            var localPath = Path.Combine(dataDir, file.FileName);

            await using (var stream = File.Create(localPath))
                await file.CopyToAsync(stream);

            string? cloudPath = null;
            if (await baidu.IsConfigured())
            {
                try
                {
                    var remotePath = $"{BaiduNetdiskService.RootDir}/user-data/flight-logs/{file.FileName}";
                    cloudPath = await baidu.UploadFile(localPath, remotePath);
                }
                catch (Exception ex) { log.Warn("flightlog", $"Cloud sync failed for {file.FileName}: {ex.Message}"); }
            }

            log.Info("flightlog", $"Flight log uploaded: {file.FileName} ({file.Length} bytes) by {actor}");
            notify.Notify("飞行日志已上传", $"{actor} 上传了 {file.FileName}", "/flightlog", targetRole: "staff");
            return Results.Ok(new { success = true, fileName = file.FileName, localPath, cloudPath });
        }).DisableAntiforgery();

        // Get flight metadata (sidecar JSON)
        group.MapGet("/{filename}/meta", (string filename) =>
        {
            var jsonPath = Path.Combine(GetDataDir(), filename + ".meta.json");
            if (!File.Exists(jsonPath)) return Results.Ok(new { });
            var json = File.ReadAllText(jsonPath);
            return Results.Ok(JsonSerializer.Deserialize<object>(json) ?? new { });
        });

        // Save flight metadata
        group.MapPut("/{filename}/meta", async (string filename, HttpRequest req, ClaimsPrincipal user, LogService log) =>
        {
            var jsonPath = Path.Combine(GetDataDir(), filename + ".meta.json");
            using var reader = new StreamReader(req.Body);
            var body = await reader.ReadToEndAsync();
            try { JsonDocument.Parse(body); } catch { return Results.Problem("Invalid JSON", statusCode: 400); }
            await File.WriteAllTextAsync(jsonPath, body);
            log.Info("flightlog", $"Flight meta saved: {filename} by {user.Identity?.Name ?? "unknown"}");
            return Results.Ok(new { success = true });
        });
    }
}
