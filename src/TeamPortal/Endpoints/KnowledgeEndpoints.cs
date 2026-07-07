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
        // Tree and content — read-only for all authenticated users (CanAccess filters by role/department)
        app.MapGet("/api/knowledge/tree", async (ClaimsPrincipal user, KnowledgeService svc, AppDbContext db) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
            var userId = idClaim is not null ? int.Parse(idClaim) : 0;
            var tree = svc.GetTree(role, dept, userId);
            return Results.Ok(tree);
        }).RequireAuthorization();

        app.MapGet("/api/knowledge/content", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(path)) return Results.Problem("Path required", statusCode: 400);
            path = Uri.UnescapeDataString(path);
            var (role, dept) = await GetUserCtx(user, db);
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            var content = svc.GetContent(path);
            return content is not null ? Results.Ok(new { path, content }) : Results.Problem("Not found", statusCode: 404);
        }).RequireAuthorization();

        // Download original binary file (PDF, DOCX, images, etc.)
        app.MapGet("/api/knowledge/download", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(path)) return Results.Problem("Path required", statusCode: 400);
            path = Uri.UnescapeDataString(path);
            var (role, dept) = await GetUserCtx(user, db);
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);

            var data = svc.GetBinaryContent(path);
            if (data is null) return Results.Problem("Not found", statusCode: 404);

            var ext = Path.GetExtension(path).ToLowerInvariant();
            var ct = ext switch
            {
                ".pdf" => "application/pdf",
                ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".doc" => "application/msword",
                ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".xls" => "application/vnd.ms-excel",
                ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".gif" => "image/gif",
                ".webp" => "image/webp",
                _ => "application/octet-stream",
            };
            return Results.File(data, ct, Path.GetFileName(path));
        }).RequireAuthorization();

        // Write/delete — staff only
        var kbWrite = app.MapGroup("/api/knowledge").RequireAuthorization("StaffOnly");
        kbWrite.MapDelete("/delete", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log) =>
        {
            if (string.IsNullOrWhiteSpace(path)) return Results.Problem("Path required", statusCode: 400);
            path = Uri.UnescapeDataString(path);
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin") return Results.Problem("Only admin can delete", statusCode: 403);
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try
            {
                svc.DeleteFile(path);
                log.Warn("knowledge", $"Deleted: [{path}] by user=[{user.FindFirstValue(ClaimTypes.NameIdentifier)}]");
                return Results.Ok(new { message = $"Deleted: {path}" });
            }
            catch (InvalidOperationException ex)
            {
                log.Error("knowledge", $"Delete failed: [{path}]", ex.Message);
                return Results.Problem(ex.Message, statusCode: 404);
            }
        });
    }
}
