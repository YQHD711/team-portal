using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Endpoints;

public static class FileEndpoints
{
    private static string UploadDir() => Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "files"));

    private static async Task<(string? role, string? dept, int id)> GetCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null, 0);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null, 0) : (u.Role, u.Department?.Name, u.Id);
    }

    public static void MapFileEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/files").RequireAuthorization();

        // List files — filtered by visibility
        g.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, dept, _) = await GetCtx(user, db);
            var query = db.SharedFiles.AsQueryable();
            if (role != "admin" && role != "部长")
                query = query.Where(f => f.Visibility == "public" || (f.Visibility == "department" && f.Department == dept));
            var files = await query.OrderByDescending(f => f.CreatedAt).Take(50).ToListAsync();
            return Results.Ok(files.Select(f => new { f.Id, f.OriginalName, f.ContentType, f.Size, f.Visibility, f.Department, f.UploaderName, f.CreatedAt }));
        });

        // Upload
        g.MapPost("/upload", async (IFormFile file, string? visibility, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);
            if (file.Length > 100 * 1024 * 1024) return Results.Problem("Max 100MB", statusCode: 400);

            var (role, dept, uid) = await GetCtx(user, db);
            var vis = visibility == "department" && !string.IsNullOrEmpty(dept) ? "department" : "public";

            Directory.CreateDirectory(UploadDir());
            var storedName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
            var path = Path.Combine(UploadDir(), storedName);
            await using (var fs = File.Create(path))
                await file.CopyToAsync(fs);

            var sf = new SharedFile
            {
                FileName = storedName, OriginalName = file.FileName,
                ContentType = file.ContentType ?? "application/octet-stream",
                Size = file.Length, Visibility = vis, Department = vis == "department" ? dept : null,
                UploaderId = uid, UploaderName = user.FindFirstValue(ClaimTypes.Name) ?? "unknown"
            };
            db.SharedFiles.Add(sf);
            await db.SaveChangesAsync();
            return Results.Ok(new { sf.Id, sf.OriginalName, sf.Size, sf.Visibility });
        }).DisableAntiforgery();

        // Download
        g.MapGet("/{id:int}/download", async (int id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, dept, _) = await GetCtx(user, db);
            var f = await db.SharedFiles.FindAsync(id);
            if (f is null) return Results.Problem("Not found", statusCode: 404);
            if (f.Visibility == "department" && role != "admin" && f.Department != dept)
                return Results.Problem("Access denied", statusCode: 403);

            var path = Path.Combine(UploadDir(), f.FileName);
            if (!File.Exists(path)) return Results.Problem("File missing", statusCode: 404);
            return Results.File(path, f.ContentType, f.OriginalName);
        });

        // Delete (staff only)
        g.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, _, _) = await GetCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            var f = await db.SharedFiles.FindAsync(id);
            if (f is null) return Results.Problem("Not found", statusCode: 404);
            var path = Path.Combine(UploadDir(), f.FileName);
            try { if (File.Exists(path)) File.Delete(path); } catch { }
            db.SharedFiles.Remove(f);
            await db.SaveChangesAsync();
            return Results.Ok(new { success = true });
        });
    }
}
