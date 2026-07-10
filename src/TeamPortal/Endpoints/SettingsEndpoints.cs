using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this WebApplication app)
    {
        var settings = app.MapGroup("/api/admin/settings").RequireAuthorization("AdminOnly");

        // Get all settings grouped by category
        settings.MapGet("/", async (SettingsService svc) =>
        {
            var grouped = await svc.GetAllGrouped();
            return Results.Ok(grouped);
        });

        // Batch update settings
        settings.MapPut("/", async (Dictionary<string, string> updates, SettingsService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            var userName = user.Identity?.Name ?? "unknown";
            var changedKeys = string.Join(", ", updates.Keys);
            await svc.BatchUpdate(updates);
            log.Warn("settings", $"Settings updated by {userName}: {changedKeys}");
            notify.Notify("系统设置已更改", $"{userName} 修改了 {updates.Count} 项设置", "/admin/settings", targetRole: "staff");
            return Results.Ok(new { success = true });
        });

        // Get single setting
        settings.MapGet("/{key}", async (string key, SettingsService svc) =>
        {
            var value = await svc.Get(key);
            return Results.Ok(new { key, value });
        });
    }
}
