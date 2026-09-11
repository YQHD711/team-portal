using System.Diagnostics;
using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 固件代理端点：对外只暴露白名单路径段，真实下载 URL 由服务端目录数据推导（见 FirmwareCatalogService）。
/// 目录类端点走 default 限流（会触发上游抓取）；下载端点不限流，避免成员下固件时被 429 打断。
/// </summary>
public static class FirmwareEndpoints
{
    public static void MapFirmwareEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/firmware").RequireAuthorization();

        // 来源 + ArduPilot 机型一次下发，前端级联不必多打一轮
        group.MapGet("/sources", () => Results.Ok(new
        {
            sources = new object[]
            {
                new
                {
                    id = FirmwareSource.ArduPilot,
                    label = "ArduPilot",
                    hint = "官方 firmware.ardupilot.org 目录",
                    vehicles = FirmwareSource.ArduPilotVehicles.Select(v => new { id = v.Key, label = v.Label })
                },
                new
                {
                    id = FirmwareSource.Px4,
                    label = "PX4",
                    hint = "官方 GitHub Releases",
                    vehicles = Array.Empty<object>()
                }
            }
        })).RequireRateLimiting("default");

        group.MapGet("/versions", async (string source, string? vehicle, FirmwareCatalogService svc) =>
            !FirmwareSource.IsKnown(source)
                ? Results.Problem("未知固件来源", statusCode: 400)
                : Catalog(await svc.GetVersionsAsync(source, vehicle))
        ).RequireRateLimiting("default");

        group.MapGet("/boards", async (string source, string? vehicle, string version, FirmwareCatalogService svc) =>
            !FirmwareSource.IsKnown(source)
                ? Results.Problem("未知固件来源", statusCode: 400)
                : Catalog(await svc.GetBoardsAsync(source, vehicle, version))
        ).RequireRateLimiting("default");

        group.MapGet("/assets", async (string source, string? vehicle, string version, string board, FirmwareCatalogService svc) =>
            !FirmwareSource.IsKnown(source)
                ? Results.Problem("未知固件来源", statusCode: 400)
                : Catalog(await svc.GetAssetsAsync(source, vehicle, version, board))
        ).RequireRateLimiting("default");

        group.MapGet("/download", Download);
    }

    /// <summary>
    /// 下载。命中缓存直接发文件；未命中则边下边转（客户端从第一个字节就有真实进度，
    /// 缓存只在整包读完后才发布）。
    /// </summary>
    private static async Task<IResult> Download(
        string source, string? vehicle, string version, string board, string asset,
        FirmwareCatalogService catalog, FirmwareCacheService cache, ClaimsPrincipal user,
        LogService log, HttpContext ctx, CancellationToken ct)
    {
        var actor = user.Identity?.Name ?? "unknown";
        var sw = Stopwatch.StartNew();
        var target = await catalog.ResolveAsync(source, vehicle, version, board, asset);
        if (target is null)
        {
            log.Warn("firmware", $"Download rejected, unknown target: {source}/{vehicle}/{version}/{board}/{asset} by {actor}");
            return Results.Problem("固件不存在，或上游目录暂时不可用", statusCode: 404);
        }
        var id = Describe(target);

        if (cache.TryGetCached(target, out var cachedPath, out var cachedBytes))
        {
            log.Info("firmware", $"Download from cache: {id} ({cachedBytes} bytes) by {actor}");
            AuditDownload(log, ctx, actor, target, cachedBytes, cached: true, sw.ElapsedMilliseconds);
            return Results.File(cachedPath, "application/octet-stream", target.FileName, enableRangeProcessing: true);
        }

        FirmwareDownload? download;
        try
        {
            download = await cache.OpenAsync(target, ct);
        }
        catch (Exception ex)
        {
            log.Error("firmware", $"Download failed: {id} by {actor}: {ex.Message}");
            AuditDownload(log, ctx, actor, target, 0, cached: false, sw.ElapsedMilliseconds, error: ex.Message);
            return Results.Problem("固件下载失败，请稍后重试", statusCode: 502);
        }
        if (download is null)
        {
            log.Error("firmware", $"Download failed upstream: {id} by {actor}");
            AuditDownload(log, ctx, actor, target, 0, cached: false, sw.ElapsedMilliseconds, error: "上游获取失败");
            return Results.Problem("固件下载失败，请稍后重试", statusCode: 502);
        }

        // 未命中缓存：先把响应头发出（带 Content-Length），客户端即可显示真实进度
        ctx.Response.ContentType = "application/octet-stream";
        ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"{target.FileName}\"";
        if (download.Length is > 0) ctx.Response.ContentLength = download.Length;
        log.Info("firmware", $"Download streaming from upstream: {id} (declared {download.Length?.ToString() ?? "unknown"} bytes) by {actor}");

        long delivered;
        try
        {
            await using (download.Stream)
                delivered = await CopyCountedAsync(download.Stream, ctx.Response.Body, ct);
        }
        catch (Exception ex)
        {
            // 响应头已发出，状态码改不了：断开连接让客户端判定为不完整传输，别让它存下坏固件
            var partial = download.Stream is FirmwareCachingStream caching ? caching.Written : 0;
            log.Error("firmware", $"Download aborted mid-stream: {id} by {actor} after {partial} bytes: {ex.Message}");
            AuditDownload(log, ctx, actor, target, partial, cached: false, sw.ElapsedMilliseconds, error: ex.Message);
            ctx.Abort();
            return Results.Empty;
        }

        log.Info("firmware", $"Download completed: {id} ({delivered} bytes, {sw.ElapsedMilliseconds}ms) by {actor}");
        AuditDownload(log, ctx, actor, target, delivered, cached: false, sw.ElapsedMilliseconds);
        return Results.Empty;
    }

    private static async Task<long> CopyCountedAsync(Stream source, Stream destination, CancellationToken ct)
    {
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, ct)) > 0)
        {
            await destination.WriteAsync(buffer.AsMemory(0, read), ct);
            total += read;
        }
        return total;
    }

    private static string Describe(FirmwareTarget t) => $"{t.Source}/{t.Version}/{t.Board}/{t.Asset.Name}";

    /// <summary>下载审计：谁、什么固件、多大、是否命中缓存、耗时；失败也落一条（success=false）。</summary>
    private static void AuditDownload(LogService log, HttpContext ctx, string actor, FirmwareTarget t,
        long bytes, bool cached, long elapsedMs, string? error = null)
    {
        object data = error is null
            ? new { success = true, bytes, cached, elapsedMs, asset = t.Asset.Name, vehicle = t.Vehicle }
            : new { success = false, bytes, cached, elapsedMs, asset = t.Asset.Name, error };
        log.Audit("download", actor, targetType: "firmware",
            targetId: $"{t.Source}/{t.Version}/{t.Board}", data: data, ipAddress: LogService.ClientIp(ctx));
    }

    /// <summary>目录为 null 一律 503（上游不可达），绝不把"取不到"伪装成"没有"。</summary>
    private static IResult Catalog<T>(IReadOnlyList<T>? items) =>
        items is null
            ? Results.Problem("上游固件目录暂时不可达，请稍后重试", statusCode: 503)
            : Results.Ok(new { items });
}
