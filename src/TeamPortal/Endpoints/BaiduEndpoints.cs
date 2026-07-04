using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class BaiduEndpoints
{
    public static void MapBaiduEndpoints(this WebApplication app)
    {
        var baidu = app.MapGroup("/api/admin/baidu").RequireAuthorization();

        // Get authorization URL
        baidu.MapGet("/auth-url", (BaiduNetdiskService svc) =>
        {
            var url = svc.GetAuthUrl();
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
            if (!svc.IsConfigured) return Results.Problem("百度网盘未配置", statusCode: 400);
            var quota = await svc.GetQuota();
            return Results.Ok(quota);
        });

        baidu.MapGet("/files", async (string? dir, BaiduNetdiskService svc) =>
        {
            if (!svc.IsConfigured) return Results.Problem("百度网盘未配置", statusCode: 400);
            var files = await svc.ListFiles(dir ?? "/");
            return Results.Ok(files);
        });

        baidu.MapPost("/upload", async (IFormFile file, string? remoteDir, BaiduNetdiskService svc) =>
        {
            if (!svc.IsConfigured) return Results.Problem("百度网盘未配置", statusCode: 400);
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

        baidu.MapGet("/download", async (string path, BaiduNetdiskService svc) =>
        {
            if (!svc.IsConfigured) return Results.Problem("百度网盘未配置", statusCode: 400);
            var url = await svc.GetDownloadUrl(path);
            return Results.Ok(new { url });
        });

        baidu.MapDelete("/files", async (string path, BaiduNetdiskService svc) =>
        {
            if (!svc.IsConfigured) return Results.Problem("百度网盘未配置", statusCode: 400);
            await svc.DeleteFile(path);
            return Results.Ok(new { success = true });
        });
    }
}

public record AuthCodeRequest(string Code);
