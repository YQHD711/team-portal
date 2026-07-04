using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class KnowledgeEndpoints
{
    private static async Task<(string? role, string? dept)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }

    public static void MapKnowledgeEndpoints(this WebApplication app)
    {
        app.MapGet("/api/knowledge/tree", async (ClaimsPrincipal user, KnowledgeService svc, AppDbContext db) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            var tree = svc.GetTree(role, dept);
            return Results.Ok(tree);
        }).RequireAuthorization();

        app.MapGet("/api/knowledge/content", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log) =>
        {
            if (string.IsNullOrWhiteSpace(path)) return Results.Problem("Path required", statusCode: 400);
            path = Uri.UnescapeDataString(path); // decode %E5%85%AC → 公共
            var (role, dept) = await GetUserCtx(user, db);
            log.Info("knowledge", $"Content request: path=[{path}] role=[{role}] dept=[{dept}] access=[{svc.CanAccess(path, role, dept)}]");
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            var content = svc.GetContent(path);
            if (content is not null) { log.Info("knowledge", $"Content found: path=[{path}] len={content.Length}"); return Results.Ok(new { path, content }); }
            log.Warn("knowledge", $"Content NOT FOUND: path=[{path}]");
            return Results.Problem("Not found", statusCode: 404);
        }).RequireAuthorization();
    }
}
