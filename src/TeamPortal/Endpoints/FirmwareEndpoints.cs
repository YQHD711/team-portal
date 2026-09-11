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

        // 下载：先解析成服务端信任的 URL，再确保落盘缓存，最后从本地发文件（支持断点续传）
        group.MapGet("/download", async (string source, string? vehicle, string version, string board, string asset,
            FirmwareCatalogService catalog, FirmwareCacheService cache, ClaimsPrincipal user, LogService log, CancellationToken ct) =>
        {
            var target = await catalog.ResolveAsync(source, vehicle, version, board, asset);
            if (target is null) return Results.Problem("固件不存在，或上游目录暂时不可用", statusCode: 404);

            var path = await cache.EnsureAsync(target, ct);
            if (path is null) return Results.Problem("固件下载失败，请稍后重试", statusCode: 502);

            log.Info("firmware", $"Firmware downloaded: {target.FileName} [{target.Source}/{target.Version}/{target.Board}] by {user.Identity?.Name ?? "unknown"}");
            return Results.File(path, "application/octet-stream", target.FileName, enableRangeProcessing: true);
        });
    }

    /// <summary>目录为 null 一律 503（上游不可达），绝不把"取不到"伪装成"没有"。</summary>
    private static IResult Catalog<T>(IReadOnlyList<T>? items) =>
        items is null
            ? Results.Problem("上游固件目录暂时不可达，请稍后重试", statusCode: 503)
            : Results.Ok(new { items });
}
