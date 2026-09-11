using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>固件缓存的查看与清理。成员只需要下载，缓存运维收在 staff/admin 后面。</summary>
public static class FirmwareAdminEndpoints
{
    public static void MapFirmwareAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/firmware/cache").RequireAuthorization();

        group.MapGet("/", (FirmwareCacheService cache) =>
        {
            var items = cache.List();
            return Results.Ok(new
            {
                items,
                totalBytes = items.Sum(i => i.Size),
                maxFileBytes = cache.MaxBytes,
                root = cache.Root
            });
        }).RequireAuthorization("StaffOnly");

        group.MapDelete("/item", (string source, string version, string board, string fileName, string? vehicle,
            FirmwareCacheService cache, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var item = new CachedFirmware(source, vehicle ?? "_", version, board, fileName, 0, 0);
            if (!cache.Delete(item)) return Results.Problem("缓存条目不存在", statusCode: 404);

            var actor = user.Identity?.Name ?? "unknown";
            log.Audit("delete", actor, targetType: "firmware-cache", targetId: $"{source}/{version}/{board}/{fileName}",
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = true });
        }).RequireAuthorization("AdminOnly");

        group.MapDelete("/", (FirmwareCacheService cache, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var (deleted, freed) = cache.Clear();
            var actor = user.Identity?.Name ?? "unknown";
            log.Audit("clear", actor, targetType: "firmware-cache", targetId: $"{deleted} files",
                data: new { deleted, freedBytes = freed }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = true, deleted, freedBytes = freed });
        }).RequireAuthorization("AdminOnly");
    }
}
