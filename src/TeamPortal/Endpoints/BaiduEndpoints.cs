using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class BaiduEndpoints
{
    public static void MapBaiduEndpoints(this WebApplication app)
    {
        var baidu = app.MapGroup("/api/admin/baidu").RequireAuthorization();

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
