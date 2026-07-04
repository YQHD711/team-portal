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

        app.MapGet("/api/knowledge/content", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(path)) return Results.Problem("Path required", statusCode: 400);
            var (role, dept) = await GetUserCtx(user, db);
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            var content = svc.GetContent(path);
            return content is not null ? Results.Ok(new { path, content }) : Results.Problem("Not found", statusCode: 404);
        }).RequireAuthorization();
    }
}
