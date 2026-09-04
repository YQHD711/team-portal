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

        wiki.MapPost("/submit-git", async (GitSubmitRequest req, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.Url) || string.IsNullOrWhiteSpace(req.ProjectName))
                return Results.Problem("URL and project name required", statusCode: 400);

            var targetFolder = req.TargetFolder ?? dept ?? "公共";
            if (!knowledge.CanAccess(targetFolder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var visibility = req.Visibility ?? "public";
            if (visibility is not "public" and not "department" and not "personal")
                return Results.Problem("Invalid visibility", statusCode: 400);

            var uid = GetUserId(user);
            var task = await generator.SubmitGit(req.Url, req.ProjectName, targetFolder, uid, visibility, req.Model, req.CustomCatalogJson);
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"Git task submitted: {req.ProjectName} (visibility={visibility})");
            log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: task.Id,
                data: new { projectName = req.ProjectName, visibility, targetFolder }, ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Ok(new { task.Id, task.Status, task.Visibility });
        });

        wiki.MapPost("/submit-zip", async (IFormFile file, string projectName, string? targetFolder, string? visibility, string? model, string? customCatalogJson, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (file is null || file.Length == 0) return Results.Problem("File required", statusCode: 400);
            if (file.Length > 100 * 1024 * 1024) return Results.Problem("Max 100MB", statusCode: 400);
            if (string.IsNullOrWhiteSpace(projectName)) return Results.Problem("Project name required", statusCode: 400);

            var folder = targetFolder ?? dept ?? "公共";
            if (!knowledge.CanAccess(folder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var vis = visibility ?? "public";
            if (vis is not "public" and not "department" and not "personal")
                return Results.Problem("Invalid visibility", statusCode: 400);

            var zipDir = Path.Combine(Path.GetTempPath(), "teamportal-zip");
            Directory.CreateDirectory(zipDir);
            var zipPath = Path.Combine(zipDir, $"{Guid.NewGuid()}.zip");
            await using (var stream = File.Create(zipPath))
                await file.CopyToAsync(stream);

            var uid = GetUserId(user);
            var task = await generator.SubmitZip(zipPath, projectName, folder, uid, vis, model, customCatalogJson);
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"ZIP task submitted: {projectName} (visibility={vis})");
            log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: task.Id,
                data: new { projectName, visibility = vis, targetFolder = folder }, ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Ok(new { task.Id, task.Status, task.Visibility });
        }).DisableAntiforgery();

        // Submit translation task — clone doc repo + AI translate to Chinese
        wiki.MapPost("/submit-translate", async (TranslateRequest req, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.Url) || string.IsNullOrWhiteSpace(req.ProjectName))
                return Results.Problem("URL and project name required", statusCode: 400);

            var folder = req.TargetFolder ?? "公共";
            var vis = req.Visibility ?? "public";
            var uid = GetUserId(user);
            var task = await generator.SubmitTranslate(req.Url, req.ProjectName, folder, uid, vis, req.Model, req.CustomCatalogJson);
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"Translate task submitted: {req.ProjectName}");
            log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: task.Id,
                data: new { projectName = req.ProjectName, visibility = vis, targetFolder = folder, type = "translate" }, ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Ok(new { task.Id, task.Status });
        });

        wiki.MapGet("/tasks", async (ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            var tasks = await generator.GetTasks();
            var filtered = tasks.Where(t =>
                t.Visibility == "public" ||
                (t.Visibility == "department" && (role == "admin" || dept == t.TargetFolder)) ||
                (t.Visibility == "personal" && (role == "admin" || t.UserId == uid))
            );
            return Results.Ok(filtered.Select(t => new { t.Id, t.Type, t.ProjectName, t.Status, t.ErrorMessage, t.Visibility, t.TargetFolder, t.CreatedAt, t.CompletedAt }));
        });

        wiki.MapGet("/tasks/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            return Results.Ok(new { task.Id, task.Type, task.ProjectName, task.Status, task.ErrorMessage, task.Visibility, task.TargetFolder, task.WorkspacePath, task.CatalogJson, task.CreatedAt, task.CompletedAt });
        });

        // Delete a wiki task
        wiki.MapDelete("/tasks/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            var ok = await generator.DeleteTask(id, knowledge);
            var log = app.Services.GetRequiredService<LogService>();
            if (ok) log.Info("wiki", $"Wiki task {id} deleted by {user.Identity?.Name}");
            else log.Warn("wiki", $"Wiki task {id} delete failed (not found) by {user.Identity?.Name}");
            log.Audit("delete", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: id,
                data: new { success = ok }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { success = true }) : Results.Problem("任务不存在", statusCode: 404);
        });

        // Update/review existing documents
        wiki.MapPost("/tasks/{id}/update", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可更新", statusCode: 403);
            var ok = await generator.UpdateDocuments(id);
            var log = app.Services.GetRequiredService<LogService>();
            if (ok) log.Info("wiki", $"Wiki task {id} document review started by {user.Identity?.Name}");
            else log.Warn("wiki", $"Wiki task {id} update failed (not found or incomplete) by {user.Identity?.Name}");
            log.Audit("update", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: id,
                data: new { success = ok, reason = ok ? null : "任务不存在或未完成" }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { success = true, message = "文档审查已启动，完成后自动更新" })
                      : Results.Problem("任务不存在或未完成", statusCode: 400);
        });

        // Change visibility of a wiki task
        wiki.MapPatch("/tasks/{id}/visibility", async (string id, VisibilityRequest req, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可修改", statusCode: 403);
            if (req.Visibility is not "public" and not "department" and not "personal")
                return Results.Problem("Invalid visibility", statusCode: 400);
            var ok = await generator.UpdateVisibility(id, req.Visibility);
            var log = app.Services.GetRequiredService<LogService>();
            if (ok) log.Info("wiki", $"Wiki task {id} visibility -> {req.Visibility} by {user.Identity?.Name}");
            else log.Warn("wiki", $"Wiki task {id} visibility change failed (not found) by {user.Identity?.Name}");
            log.Audit("update", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: id,
                data: new { visibility = req.Visibility, success = ok }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { success = true }) : Results.Problem("任务不存在", statusCode: 404);
        });

        // Serve catalog for wiki viewer
        wiki.MapGet("/tasks/{id}/catalog", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            if (string.IsNullOrEmpty(task.CatalogJson)) return Results.Ok(new List<object>());
            return Results.Content(task.CatalogJson, "application/json");
        });

        // Serve wiki document content for viewer
        wiki.MapGet("/tasks/{id}/doc", async (string id, string path, string? lang, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, KnowledgeService knowledge) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            var projName = lang == "en" ? $"{task.ProjectName}_EN" : task.ProjectName;
            var kbPath = $"{task.TargetFolder}/{projName}/{path}.md".Replace("//", "/");
            var content = knowledge.GetContent(kbPath);
            if (content is not null)
            {
                // Convert wiki-style links: [[Page Name]] or [[Page Name|Display Text]]
                content = System.Text.RegularExpressions.Regex.Replace(content,
                    @"\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]",
                    m => {
                        var page = m.Groups[1].Value.Trim();
                        var text = m.Groups[2].Success ? m.Groups[2].Value.Trim() : page;
                        var encoded = Uri.EscapeDataString(page.Replace(" ", "-"));
                        return $"[{text}](?path={encoded})";
                    });
                // Also fix relative links to other .md files in the same project
                content = System.Text.RegularExpressions.Regex.Replace(content,
                    @"\[([^\]]+?)\]\(([^)]+?)\)",
                    m => {
                        var text = m.Groups[1].Value;
                        var link = m.Groups[2].Value;
                        if (link.StartsWith("http") || link.StartsWith("#") || link.StartsWith("/")) return m.Value;
                        var cleanLink = link.Replace(".md", "").Replace(' ', '-');
                        return $"[{text}](?path={Uri.EscapeDataString(cleanLink)}&lang={lang ?? "zh"})";
                    });
                return Results.Ok(new { path, content });
            }
            // Fallback: try the other language
            var fallbackName = lang == "en" ? task.ProjectName : $"{task.ProjectName}_EN";
            var fbPath = $"{task.TargetFolder}/{fallbackName}/{path}.md".Replace("//", "/");
            var fbContent = knowledge.GetContent(fbPath);
            return fbContent is not null ? Results.Ok(new { path, content = fbContent }) : Results.Problem("Document not found", statusCode: 404);
        });

        // Source code file viewer
        wiki.MapGet("/tasks/{id}/blob/{**path}", async (string id, string path, HttpContext ctx, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null || string.IsNullOrEmpty(task.WorkspacePath)) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
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

        // Wiki settings (staff only)
        wiki.MapGet("/settings", async (ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            return Results.Ok(generator.GetOptions());
        });
        wiki.MapPut("/settings", async (WikiGeneratorOptions opts, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可修改", statusCode: 403);
            generator.UpdateOptions(opts);
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"Wiki settings updated by {user.Identity?.Name}");
            log.Audit("settings", user.Identity?.Name ?? "unknown", targetType: "wiki-settings",
                data: new { success = true }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = true });
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

    private static bool CanViewTask(Data.Models.WikiTask task, string? role, string? dept, int userId) =>
        task.Visibility == "public" ||
        (task.Visibility == "department" && (role == "admin" || dept == task.TargetFolder)) ||
        (task.Visibility == "personal" && (role == "admin" || task.UserId == userId));
}

public record GitSubmitRequest(string Url, string ProjectName, string? TargetFolder, string? Visibility, string? Model = null, string? CustomCatalogJson = null);
public record TranslateRequest(string Url, string ProjectName, string? TargetFolder, string? Visibility, string? Model = null, string? CustomCatalogJson = null);
public record VisibilityRequest(string Visibility);
