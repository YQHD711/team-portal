using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class BaiduEndpoints
{
    public static void MapBaiduEndpoints(this WebApplication app)
    {
        var baidu = app.MapGroup("/api/admin/baidu").RequireAuthorization("AdminOnly");

        // Get authorization URL
        baidu.MapGet("/auth-url", async (BaiduNetdiskService svc) =>
        {
            var url = await svc.GetAuthUrl();
            return Results.Ok(new { url, message = "在浏览器中打开此链接，登录百度账号并授权，然后将返回的授权码粘贴到下方" });
        });

        // Exchange authorization code
        baidu.MapPost("/auth-code", async (AuthCodeRequest req, BaiduNetdiskService svc) =>
        {
            var result = await svc.ExchangeCode(req.Code);
            return Results.Ok(new { success = true, message = result });
        });

        baidu.MapGet("/quota", async (BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            var quota = await svc.GetQuota();
            return Results.Ok(quota);
        });

        baidu.MapGet("/files", async (string? dir, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            var files = await svc.ListFiles(dir ?? "/");
            return Results.Ok(files);
        });

        baidu.MapPost("/upload", async (IFormFile file, string? remoteDir, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);

            var tempPath = Path.GetTempFileName();
            await using (var stream = File.Create(tempPath))
                await file.CopyToAsync(stream);

            var dir = remoteDir ?? "/apps/team-portal";
            var remotePath = $"{dir}/{file.FileName}";
            await svc.UploadFile(tempPath, remotePath);
            File.Delete(tempPath);
            return Results.Ok(new { success = true, path = remotePath });
        }).DisableAntiforgery();

        baidu.MapGet("/download", async (long fsId, HttpContext ctx, BaiduNetdiskService svc) =>
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

        baidu.MapDelete("/files", async (string path, BaiduNetdiskService svc) =>
        {
            if (!await svc.IsConfigured()) return Results.Problem("百度网盘未配置", statusCode: 400);
            await svc.DeleteFile(path);
            return Results.Ok(new { success = true });
        });
    }
}

public record AuthCodeRequest(string Code);
