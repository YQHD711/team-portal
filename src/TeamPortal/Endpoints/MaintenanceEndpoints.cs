using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class MaintenanceEndpoints
{
    public static void MapMaintenanceEndpoints(this WebApplication app)
    {
        var m = app.MapGroup("/api/admin/maintenance").RequireAuthorization("AdminOnly");

        m.MapGet("/", async (MaintenanceService svc) => Results.Ok(await svc.GetHistory()));

        m.MapPost("/apply", async (MaintenanceService svc) =>
        {
            var result = await svc.ApplyChanges();
            return Results.Ok(result);
        });

        m.MapPost("/rollback", async (MaintenanceService svc) =>
        {
            var result = await svc.Rollback();
            return Results.Ok(result);
        });
    }
}
