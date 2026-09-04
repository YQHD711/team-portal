using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class BaiduEndpoints
{
    public static void MapBaiduEndpoints(this WebApplication app)
    {
        var baidu = app.MapGroup("/api/admin/baidu").RequireAuthorization("AdminOnly");

        // Public cloud file view — authenticated users can view/download cloud files
        // Use /api/baidu/view/{fsId} as embeddable link in knowledge base, inventory, etc.
        var publicCloud = app.MapGroup("/api/baidu").RequireAuthorization();
        publicCloud.MapGet("/view/{fsId:long}", async (long fsId, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            try
            {
                var (stream, fileName, size) = await svc.GetDownloadStream(fsId);
                await using (stream)
                {
                    var ext = Path.GetExtension(fileName).ToLowerInvariant();
                    var ct = ext switch
                    {
                        ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png",
                        ".gif" => "image/gif", ".webp" => "image/webp", ".svg" => "image/svg+xml",
                        ".pdf" => "application/pdf", _ => "application/octet-stream",
                    };
                    var inline = ct.StartsWith("image/") || ct == "application/pdf" ? "inline" : "attachment";
                    ctx.Response.ContentType = ct;
                    ctx.Response.Headers.ContentDisposition = $"{inline}; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
                    if (size > 0) ctx.Response.Headers.ContentLength = size;
                    await stream.CopyToAsync(ctx.Response.Body);
                }
            }
            catch (Exception ex)
            {
                ctx.Response.StatusCode = 404;
                ctx.Response.ContentType = "text/plain";
                await ctx.Response.WriteAsync($"File not found: {ex.Message}");
            }
        });

        // View file by cloud path (resolves to fsId internally)
        publicCloud.MapGet("/view-by-path", async (string path, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            try
            {
                var parentDir = Path.GetDirectoryName(path)?.Replace('\\', '/') ?? "/";
                var fileName = Path.GetFileName(path);
                var files = await svc.ListFiles(parentDir);
                var file = files.FirstOrDefault(f => f.FileName == fileName && !f.IsDir);
                if (file is null) { ctx.Response.StatusCode = 404; await ctx.Response.WriteAsync("File not found"); return; }

                var (stream, _, size) = await svc.GetDownloadStream(file.FsId);
                await using (stream)
                {
                    var ext = Path.GetExtension(fileName).ToLowerInvariant();
                    var ct = ext switch
                    {
                        ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png",
                        ".gif" => "image/gif", ".webp" => "image/webp", ".svg" => "image/svg+xml",
                        ".pdf" => "application/pdf", _ => "application/octet-stream",
                    };
                    var inline = ct.StartsWith("image/") || ct == "application/pdf" ? "inline" : "attachment";
                    ctx.Response.ContentType = ct;
                    ctx.Response.Headers.ContentDisposition = $"{inline}; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
                    if (size > 0) ctx.Response.Headers.ContentLength = size;
                    await stream.CopyToAsync(ctx.Response.Body);
                }
            }
            catch (Exception ex)
            {
                ctx.Response.StatusCode = 404;
                ctx.Response.ContentType = "text/plain";
                await ctx.Response.WriteAsync($"File not found: {ex.Message}");
            }
        });

        var adminBaidu = app.MapGroup("/api/admin/baidu").RequireAuthorization("AdminOnly");

        // Get authorization URL
        adminBaidu.MapGet("/auth-url", async (BaiduNetdiskService svc) =>
        {
            var url = await svc.GetAuthUrl();
            return Results.Ok(new { url, message = "在浏览器中打开此链接，登录百度账号并授权，然后将返回的授权码粘贴到下方" });
        });

        // Exchange authorization code
        adminBaidu.MapPost("/auth-code", async (AuthCodeRequest req, BaiduNetdiskService svc) =>
        {
            var result = await svc.ExchangeCode(req.Code);
            return Results.Ok(new { success = true, message = result });
        });

        adminBaidu.MapGet("/quota", async (BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            var quota = await svc.GetQuota();
            return Results.Ok(quota);
        });

        adminBaidu.MapGet("/files", async (string? dir, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            var files = await svc.ListFiles(dir ?? "/");
            return Results.Ok(files);
        });

        adminBaidu.MapPost("/upload", async (IFormFile file, string? remoteDir, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);

            var tempPath = Path.GetTempFileName();
            await using (var stream = File.Create(tempPath))
                await file.CopyToAsync(stream);

            var dir = remoteDir ?? BaiduNetdiskService.DefaultUploadDir;
            var remotePath = $"{dir}/{file.FileName}";
            await svc.UploadFile(tempPath, remotePath);
            File.Delete(tempPath);
            return Results.Ok(new { success = true, path = remotePath });
        }).DisableAntiforgery();

        adminBaidu.MapGet("/download", async (long fsId, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured())
            {
                ctx.Response.StatusCode = 400;
                return;
            }
            try
            {
                var (stream, fileName, size) = await svc.GetDownloadStream(fsId);
                ctx.Response.ContentType = "application/octet-stream";
                ctx.Response.Headers.ContentDisposition = $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
                if (size > 0) ctx.Response.Headers.ContentLength = size;
                await stream.CopyToAsync(ctx.Response.Body);
            }
            catch (Exception ex)
            {
                ctx.Response.StatusCode = 500;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsync($"{{\"error\":\"{ex.Message.Replace("\"", "'")}\"}}");
            }
        });

        adminBaidu.MapDelete("/files", async (string path, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            await svc.DeleteFile(path);
            return Results.Ok(new { success = true });
        });

        // One-click system backup (DB + settings → zip → cloud)
        adminBaidu.MapPost("/backup", async (BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            try
            {
                var path = await svc.BackupSystem();
                return Results.Ok(new { success = true, path, message = $"备份已保存到 {path}" });
            }
            catch (Exception ex)
            {
                return Results.Problem($"备份失败: {ex.Message}", statusCode: 500);
            }
        });

        // Initialize folder structure (one-click setup)
        adminBaidu.MapPost("/init-folders", async (BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            await svc.EnsureFolderStructure();
            return Results.Ok(new
            {
                success = true,
                message = "文件夹结构初始化完成",
                structure = new[]
                {
                    $"{BaiduNetdiskService.RootDir}/system/backups",
                    $"{BaiduNetdiskService.RootDir}/system/logs",
                    $"{BaiduNetdiskService.RootDir}/system/configs",
                    $"{BaiduNetdiskService.RootDir}/user-data/flight-logs",
                    $"{BaiduNetdiskService.RootDir}/user-data/photos-videos",
                    $"{BaiduNetdiskService.RootDir}/user-data/documents",
                }
            });
        });
    }
}

public record AuthCodeRequest(string Code);
