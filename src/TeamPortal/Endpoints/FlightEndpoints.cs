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

        bg.MapPost("/", async (BatteryRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc, LogService log) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可添加", statusCode: 403);
            var b = await svc.CreateBattery(req.BatteryNumber, req.Health, req.IncidentDate, req.Notes);
            log.Info("flight", $"Battery added: {req.BatteryNumber} by {user.Identity?.Name}");
            return Results.Created($"/api/batteries/{b.Id}", b);
        });

        bg.MapPut("/{id:int}", async (int id, BatteryRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc, LogService log) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var ok = await svc.UpdateBattery(id, req.BatteryNumber, req.Health, req.IncidentDate, req.Notes);
            if (ok) log.Info("flight", $"Battery #{id} updated: {req.BatteryNumber} by {user.Identity?.Name}");
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("Not found", statusCode: 404);
        });

        bg.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, FlightService svc, LogService log) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            await svc.DeleteBattery(id);
            log.Warn("flight", $"Battery #{id} deleted by {user.Identity?.Name}");
            return Results.Ok(new { message = "已删除" });
        });

        // ── Incidents ──
        var ig = app.MapGroup("/api/incidents").RequireAuthorization();

        ig.MapGet("/", async (int? page, ClaimsPrincipal user, AppDbContext db, FlightService svc) =>
        {
            var (role, dept) = await GetCtx(user, db);
            var uid = int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var deptId = await db.Users.Where(u => u.Id == uid).Select(u => u.DepartmentId).FirstOrDefaultAsync();
            var items = await svc.GetIncidents(uid, role, dept, deptId, page ?? 1);
            return Results.Ok(items);
        });

        ig.MapPost("/", async (IncidentRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc, LogService log) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可添加", statusCode: 403);
            var uid = int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var deptId = await db.Users.Where(u => u.Id == uid).Select(u => u.DepartmentId).FirstOrDefaultAsync();
            var inc = await svc.CreateIncident(req.Type, req.Severity, req.Description, req.Date,
                req.Resolution, req.ReportedBy, uid, deptId);
            log.Info("flight", $"Incident added: {req.Type}/{req.Severity} by {user.Identity?.Name}");
            return Results.Created($"/api/incidents/{inc.Id}", inc);
        });

        ig.MapPut("/{id:int}", async (int id, IncidentRequest req, ClaimsPrincipal user, AppDbContext db, FlightService svc, LogService log) =>
        {
            var (role, dept) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var uid = int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var deptId = await db.Users.Where(u => u.Id == uid).Select(u => u.DepartmentId).FirstOrDefaultAsync();
            var ok = await svc.UpdateIncident(id, req.Type, req.Severity, req.Description, req.Date, req.Resolution);
            if (ok) log.Info("flight", $"Incident #{id} updated: {req.Type} by {user.Identity?.Name}");
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("Not found", statusCode: 404);
        });

        ig.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, FlightService svc, LogService log) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            await svc.DeleteIncident(id);
            log.Warn("flight", $"Incident #{id} deleted by {user.Identity?.Name}");
            return Results.Ok(new { message = "已删除" });
        });
    }
}

public record BatteryRequest(string BatteryNumber, string? Health, DateTime IncidentDate, string? Notes);
public record IncidentRequest(string Type, string Severity, string Description, DateTime Date, string? Resolution, string? ReportedBy);
