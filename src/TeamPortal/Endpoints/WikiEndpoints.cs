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
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.Url) || string.IsNullOrWhiteSpace(req.ProjectName))
                return Results.Problem("URL and project name required", statusCode: 400);

            var targetFolder = req.TargetFolder ?? dept ?? "公共";
            if (!knowledge.CanAccess(targetFolder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var uid = GetUserId(user);
            var task = await generator.SubmitGit(req.Url, req.ProjectName, targetFolder, uid);
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"Git task submitted: {req.ProjectName}", $"{{\"url\":\"{req.Url}\"}}");
            return Results.Ok(new { task.Id, task.Status });
        });

        wiki.MapPost("/submit-zip", async (IFormFile file, string projectName, string? targetFolder, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (file is null || file.Length == 0) return Results.Problem("File required", statusCode: 400);
            if (file.Length > 100 * 1024 * 1024) return Results.Problem("Max 100MB", statusCode: 400);
            if (string.IsNullOrWhiteSpace(projectName)) return Results.Problem("Project name required", statusCode: 400);

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
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"ZIP task submitted: {projectName}", $"{{\"size\":{file.Length}}}");
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

        // Serve catalog for wiki viewer
        wiki.MapGet("/tasks/{id}/catalog", async (string id, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            if (string.IsNullOrEmpty(task.CatalogJson)) return Results.Ok(new List<object>());
            return Results.Content(task.CatalogJson, "application/json");
        });

        // Serve wiki document content for viewer
        wiki.MapGet("/tasks/{id}/doc", async (string id, string path, WikiGeneratorService generator, KnowledgeService knowledge) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var kbPath = $"{task.TargetFolder}/{task.ProjectName}/{path}.md".Replace("//", "/");
            var content = knowledge.GetContent(kbPath);
            return content is not null ? Results.Ok(new { path, content }) : Results.Problem("Document not found", statusCode: 404);
        });

        // Source code file viewer
        wiki.MapGet("/tasks/{id}/blob/{**path}", async (string id, string path, HttpContext ctx, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null || string.IsNullOrEmpty(task.WorkspacePath)) return Results.Problem("Not found", statusCode: 404);
            var fullPath = Path.GetFullPath(Path.Combine(task.WorkspacePath, path));
            if (!fullPath.StartsWith(Path.GetFullPath(task.WorkspacePath))) return Results.Problem("Access denied", statusCode: 403);
            if (!File.Exists(fullPath)) return Results.Problem("File not found", statusCode: 404);
            var ext = Path.GetExtension(fullPath).ToLowerInvariant();
            var isBinary = new[] { ".dll", ".exe", ".png", ".jpg", ".ico", ".zip" }.Contains(ext);
            if (isBinary) return Results.Problem("Binary file", statusCode: 400);
            var content = await File.ReadAllTextAsync(fullPath);
            var language = ext switch { ".cs" => "csharp", ".py" => "python", ".ts" => "typescript", ".tsx" => "typescript", ".js" => "javascript", ".go" => "go", ".rs" => "rust", ".java" => "java", ".md" => "markdown", ".json" => "json", ".xml" => "xml", ".html" => "html", ".css" => "css", ".sql" => "sql", _ => "" };
            var lines = content.Split('\n');

            // Return HTML page for browser viewing
            if (ctx.Request.Headers.Accept.ToString().Contains("text/html"))
            {
                var htmlLines = string.Join("", lines.Select((l, i) => $"<tr><td class='ln'>{i+1}</td><td class='code'>{System.Net.WebUtility.HtmlEncode(l)}</td></tr>"));
                var langTag = !string.IsNullOrEmpty(language) ? $"<span class='lang'>{language}</span>" : "";
                var html = $@"<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'><title>{path} — {task.ProjectName}</title>
<style>body{{margin:0;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;background:#1e1e1e;color:#d4d4d4}}
.header{{padding:10px 16px;background:#252526;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center}}
.header a{{color:#4fc3f7;text-decoration:none;font-size:12px}}
table{{width:100%;border-collapse:collapse}}td{{padding:0 8px;line-height:1.4}}td.ln{{width:50px;text-align:right;color:#858585;border-right:1px solid #333;user-select:none;vertical-align:top}}
td.code{{white-space:pre;padding-left:12px;color:#d4d4d4}}.lang{{font-size:11px;color:#858585;margin-left:8px}}</style></head><body>
<div class='header'><span>{System.Net.WebUtility.HtmlEncode(path)}{langTag}</span><a href='/wiki/{id}'>← 返回文档</a></div>
<table>{htmlLines}</table></body></html>";
                return Results.Content(html, "text/html; charset=utf-8");
            }

            return Results.Ok(new { path, content, language, lines = lines.Length });
        });

        // Wiki settings
        wiki.MapGet("/settings", (WikiGeneratorService generator) => Results.Ok(generator.GetOptions()));
        wiki.MapPut("/settings", (WikiGeneratorOptions opts, WikiGeneratorService generator) => { generator.UpdateOptions(opts); return Results.Ok(new { success = true }); });
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
