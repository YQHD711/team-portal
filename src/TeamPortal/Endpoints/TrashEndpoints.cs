using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class TrashEndpoints
{
    private static async Task<(string? role, string? dept)> GetCtx(ClaimsPrincipal u, AppDbContext db)
    {
        var id = u.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null) return (null, null);
        var x = await db.Users.Include(usr => usr.Department).FirstOrDefaultAsync(usr => usr.Id == int.Parse(id));
        return x is null ? (null, null) : (x.Role, x.Department?.Name);
    }

    private static bool IsStaff(string? r) => r == "admin" || r == "部长";

    public static void MapTrashEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/trash").RequireAuthorization();

        group.MapGet("/", async (int? page, ClaimsPrincipal user, AppDbContext db, TrashService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可访问", statusCode: 403);
            var items = await svc.GetTrashItems(page ?? 1);
            return Results.Ok(new { items, total = items.Count });
        });

        group.MapGet("/{id:long}", async (long id, ClaimsPrincipal user, AppDbContext db, TrashService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可访问", statusCode: 403);
            var item = await svc.GetTrashItem(id);
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapPost("/{id:long}/restore", async (long id, ClaimsPrincipal user, AppDbContext db, TrashService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var ok = await svc.Restore(id);
            return ok ? Results.Ok(new { message = "已恢复" }) : Results.Problem("恢复失败", statusCode: 500);
        });

        group.MapDelete("/{id:long}", async (long id, ClaimsPrincipal user, AppDbContext db, TrashService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            await svc.DeleteForever(id);
            return Results.Ok(new { message = "已永久删除" });
        });

        group.MapPost("/cleanup", async (ClaimsPrincipal user, AppDbContext db, TrashService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var count = await svc.CleanupOld(30);
            return Results.Ok(new { message = $"已清理 {count} 条过期记录" });
        });
    }
}
