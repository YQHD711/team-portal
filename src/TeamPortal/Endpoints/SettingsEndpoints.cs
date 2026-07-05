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
        settings.MapPut("/", async (Dictionary<string, string> updates, SettingsService svc) =>
        {
            await svc.BatchUpdate(updates);
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
