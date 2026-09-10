using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class BaiduEndpoints
{
    /// <summary>
    /// 云端文件可见范围:非管理员只能访问 user-data 下的用户数据。
    /// <para>
    /// system 目录(如 system/backups/*.zip)是整库备份(含口令哈希),
    /// 而 /api/baidu/view* 只要求登录 —— 不限制范围时任何成员都能下载备份。
    /// 同时拒绝含 ".." 的路径,避免用 ../../ 绕过前缀判断。
    /// </para>
    /// </summary>
    internal static bool CanViewCloudPath(string? cloudPath, string? role)
    {
        if (role == "admin") return true;
        if (string.IsNullOrEmpty(cloudPath)) return false;
        if (cloudPath.Contains("..", StringComparison.Ordinal)) return false;
        return cloudPath.StartsWith(BaiduNetdiskService.RootDir + "/user-data/", StringComparison.Ordinal);
    }

    public static void MapBaiduEndpoints(this WebApplication app)
    {
        var baidu = app.MapGroup("/api/admin/baidu").RequireAuthorization("AdminOnly");

        // Public cloud file view — authenticated users can view/download cloud files
        // Use /api/baidu/view/{fsId} as embeddable link in knowledge base, inventory, etc.
        var publicCloud = app.MapGroup("/api/baidu").RequireAuthorization();
        publicCloud.MapGet("/view/{fsId:long}", async (long fsId, HttpContext ctx, ClaimsPrincipal user, BaiduNetdiskService svc) =>
        {
            try
            {
                var (stream, fileName, size, cloudPath) = await svc.GetDownloadStream(fsId, ctx.RequestAborted);
                if (!CanViewCloudPath(cloudPath, user.FindFirstValue(ClaimTypes.Role)))
                {
                    await stream.DisposeAsync();
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    ctx.Response.ContentType = "text/plain";
                    await ctx.Response.WriteAsync("Access denied");
                    return;
                }
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
                    await stream.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
                }
            }
            catch (Exception ex)
            {
                if (ctx.Response.HasStarted) return; // 已在传输 body,无法再改状态码
                ctx.Response.StatusCode = 404;
                ctx.Response.ContentType = "text/plain";
                await ctx.Response.WriteAsync($"File not found: {ex.Message}");
            }
        });

        // View file by cloud path (resolves to fsId internally)
        publicCloud.MapGet("/view-by-path", async (string path, HttpContext ctx, ClaimsPrincipal user, BaiduNetdiskService svc) =>
        {
            try
            {
                if (!CanViewCloudPath(path, user.FindFirstValue(ClaimTypes.Role)))
                {
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    ctx.Response.ContentType = "text/plain";
                    await ctx.Response.WriteAsync("Access denied");
                    return;
                }
                var parentDir = Path.GetDirectoryName(path)?.Replace('\\', '/') ?? "/";
                var fileName = Path.GetFileName(path);
                var files = await svc.ListFiles(parentDir, ctx.RequestAborted);
                var file = files.FirstOrDefault(f => f.FileName == fileName && !f.IsDir);
                if (file is null) { ctx.Response.StatusCode = 404; await ctx.Response.WriteAsync("File not found"); return; }

                var (stream, _, size, _) = await svc.GetDownloadStream(file.FsId, ctx.RequestAborted);
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
                    await stream.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
                }
            }
            catch (Exception ex)
            {
                if (ctx.Response.HasStarted) return; // 已在传输 body,无法再改状态码
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
        adminBaidu.MapPost("/auth-code", async (AuthCodeRequest req, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            var result = await svc.ExchangeCode(req.Code, ctx.RequestAborted);
            return Results.Ok(new { success = true, message = result });
        });

        adminBaidu.MapGet("/quota", async (HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            var quota = await svc.GetQuota(ctx.RequestAborted);
            return Results.Ok(quota);
        });

        adminBaidu.MapGet("/files", async (string? dir, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            var files = await svc.ListFiles(dir ?? "/", ctx.RequestAborted);
            return Results.Ok(files);
        });

        adminBaidu.MapPost("/upload", async (IFormFile file, string? remoteDir, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);

            var tempPath = Path.GetTempFileName();
            try
            {
                await using (var stream = File.Create(tempPath))
                    await file.CopyToAsync(stream, ctx.RequestAborted);

                var dir = remoteDir ?? BaiduNetdiskService.DefaultUploadDir;
                var remotePath = $"{dir}/{file.FileName}";
                await svc.UploadFile(tempPath, remotePath, null, ctx.RequestAborted);
                return Results.Ok(new { success = true, path = remotePath });
            }
            finally
            {
                File.Delete(tempPath); // 上传失败也要清理,否则 /tmp 会被临时文件堆满
            }
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
                var (stream, fileName, size, _) = await svc.GetDownloadStream(fsId, ctx.RequestAborted);
                await using (stream)
                {
                    ctx.Response.ContentType = "application/octet-stream";
                    ctx.Response.Headers.ContentDisposition = $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
                    if (size > 0) ctx.Response.Headers.ContentLength = size;
                    await stream.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
                }
            }
            catch (Exception ex)
            {
                if (ctx.Response.HasStarted) return; // 已在传输 body,无法再改状态码
                ctx.Response.StatusCode = 500;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsync($"{{\"error\":\"{ex.Message.Replace("\"", "'")}\"}}");
            }
        });

        adminBaidu.MapDelete("/files", async (string path, HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            await svc.DeleteFile(path, ctx.RequestAborted);
            return Results.Ok(new { success = true });
        });

        // One-click system backup (DB + settings → zip → cloud)
        adminBaidu.MapPost("/backup", async (HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            try
            {
                var path = await svc.BackupSystem(ctx.RequestAborted);
                return Results.Ok(new { success = true, path, message = $"备份已保存到 {path}" });
            }
            catch (Exception ex)
            {
                return Results.Problem($"备份失败: {ex.Message}", statusCode: 500);
            }
        });

        // Initialize folder structure (one-click setup)
        adminBaidu.MapPost("/init-folders", async (HttpContext ctx, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            await svc.EnsureFolderStructure(ctx.RequestAborted);
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
