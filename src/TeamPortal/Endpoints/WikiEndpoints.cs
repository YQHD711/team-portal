using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class WikiEndpoints
{
    public static void MapWikiEndpoints(this WebApplication app)
    {
        var wiki = app.MapGroup("/api/wiki").RequireAuthorization();

        wiki.MapPost("/submit-git", async (GitSubmitRequest req, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge) =>
        {
            if (string.IsNullOrWhiteSpace(req.Url) || string.IsNullOrWhiteSpace(req.ProjectName))
                return Results.Problem("URL and project name required", statusCode: 400);

            var (role, dept) = await GetUserCtx(user, db);
            var targetFolder = req.TargetFolder ?? dept ?? "公共";

            if (!knowledge.CanAccess(targetFolder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var uid = GetUserId(user);
            var task = await generator.SubmitGit(req.Url, req.ProjectName, targetFolder, uid);
            return Results.Ok(new { task.Id, task.Status });
        });

        wiki.MapPost("/submit-zip", async (IFormFile file, string projectName, string? targetFolder, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("File required", statusCode: 400);
            if (file.Length > 100 * 1024 * 1024) return Results.Problem("Max 100MB", statusCode: 400);
            if (string.IsNullOrWhiteSpace(projectName)) return Results.Problem("Project name required", statusCode: 400);

            var (role, dept) = await GetUserCtx(user, db);
            var folder = targetFolder ?? dept ?? "公共";

            if (!knowledge.CanAccess(folder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var zipDir = Path.Combine(Path.GetTempPath(), "teamportal-zip");
            Directory.CreateDirectory(zipDir);
            var zipPath = Path.Combine(zipDir, $"{Guid.NewGuid()}.zip");
            await using (var stream = File.Create(zipPath))
                await file.CopyToAsync(stream);

            var uid = GetUserId(user);
            var task = await generator.SubmitZip(zipPath, projectName, folder, uid);
            return Results.Ok(new { task.Id, task.Status });
        }).DisableAntiforgery();

        wiki.MapGet("/tasks", async (WikiGeneratorService generator) =>
        {
            var tasks = await generator.GetTasks();
            return Results.Ok(tasks.Select(t => new { t.Id, t.Type, t.ProjectName, t.Status, t.ErrorMessage, t.CreatedAt, t.CompletedAt }));
        });

        wiki.MapGet("/tasks/{id}", async (string id, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            return task is not null ? Results.Ok(task) : Results.Problem("Not found", statusCode: 404);
        });
    }

    private static int GetUserId(ClaimsPrincipal user) { var c = user.FindFirstValue(ClaimTypes.NameIdentifier); return c is not null ? int.Parse(c) : 0; }

    private static async Task<(string? role, string? dept)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }
}

public record GitSubmitRequest(string Url, string ProjectName, string? TargetFolder);
