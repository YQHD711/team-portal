using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class FlightEndpoints
{
    private static int? GetUserId(ClaimsPrincipal user)
    {
        var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is not null ? int.Parse(id) : null;
    }

    private static async Task<(string? role, string? dept)> GetCtx(ClaimsPrincipal u, AppDbContext db)
    {
        var id = u.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null) return (null, null);
        var x = await db.Users.Include(usr => usr.Department).FirstOrDefaultAsync(usr => usr.Id == int.Parse(id));
        return x is null ? (null, null) : (x.Role, x.Department?.Name);
    }

    private static bool IsStaff(string? r) => r == "admin" || r == "部长";

    public static void MapFlightEndpoints(this WebApplication app)
    {
        var fg = app.MapGroup("/api/flights").RequireAuthorization();

        // ── Batteries ──
        var bg = app.MapGroup("/api/batteries").RequireAuthorization();

        bg.MapGet("/", async (FlightService svc) => Results.Ok(await svc.GetBatteries()));

        bg.MapPost("/", async (BatteryRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可添加", statusCode: 403);
            var b = await svc.CreateBattery(req.BatteryNumber, req.Health, req.IncidentDate, req.Notes);
            return Results.Created($"/api/batteries/{b.Id}", b);
        });

        bg.MapPut("/{id:int}", async (int id, BatteryRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var ok = await svc.UpdateBattery(id, req.BatteryNumber, req.Health, req.IncidentDate, req.Notes);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("Not found", statusCode: 404);
        });

        bg.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            await svc.DeleteBattery(id);
            return Results.Ok(new { message = "已删除" });
        });

        // ── Incidents ──
        var ig = app.MapGroup("/api/incidents").RequireAuthorization();

        ig.MapGet("/", async (int? page, FlightService svc) => Results.Ok(await svc.GetIncidents(page ?? 1)));

        ig.MapPost("/", async (IncidentRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可添加", statusCode: 403);
            var inc = await svc.CreateIncident(req.Type, req.Severity, req.Description, req.Date,
                req.Resolution, req.ReportedBy);
            return Results.Created($"/api/incidents/{inc.Id}", inc);
        });

        ig.MapPut("/{id:int}", async (int id, IncidentRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var ok = await svc.UpdateIncident(id, req.Type, req.Severity, req.Description, req.Date, req.Resolution);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("Not found", statusCode: 404);
        });

        ig.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            await svc.DeleteIncident(id);
            return Results.Ok(new { message = "已删除" });
        });
    }
}

public record BatteryRequest(string BatteryNumber, string? Health, DateTime IncidentDate, string? Notes);
public record IncidentRequest(string Type, string Severity, string Description, DateTime Date, string? Resolution, string? ReportedBy);
