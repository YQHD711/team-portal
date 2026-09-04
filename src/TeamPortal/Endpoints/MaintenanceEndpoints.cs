using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class MaintenanceEndpoints
{
    public static void MapMaintenanceEndpoints(this WebApplication app)
    {
        var m = app.MapGroup("/api/admin/maintenance").RequireAuthorization("AdminOnly");

        m.MapGet("/", async (MaintenanceService svc) => Results.Ok(await svc.GetHistory()));

        m.MapPost("/apply", async (MaintenanceService svc, ClaimsPrincipal user, LogService log) =>
        {
            try
            {
                var result = await svc.ApplyChanges();
                log.Info("maintenance", $"Maintenance changes applied by {user.Identity?.Name}");
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                log.Warn("maintenance", $"Maintenance apply failed by {user.Identity?.Name}: {ex.Message}");
                throw;
            }
        });

        m.MapPost("/rollback", async (MaintenanceService svc, ClaimsPrincipal user, LogService log) =>
        {
            try
            {
                var result = await svc.Rollback();
                log.Warn("maintenance", $"Maintenance rolled back by {user.Identity?.Name}");
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                log.Warn("maintenance", $"Maintenance rollback failed by {user.Identity?.Name}: {ex.Message}");
                throw;
            }
        });
    }
}
