using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static partial class WikiEndpoints
{
    public static void MapWikiEndpoints(this WebApplication app)
    {
        var wiki = app.MapGroup("/api/wiki").RequireAuthorization().RequireRateLimiting("default");

        wiki.MapPost("/submit-git", async (GitSubmitRequest req, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.Url) || string.IsNullOrWhiteSpace(req.ProjectName))
                return Results.Problem("URL and project name required", statusCode: 400);

            // FIX-02（审计 I-04）：ProjectName/TargetFolder 会拼进知识库路径、回收站路径与文档写入路径，
            // 必须是最简单的**单段名**。`..`、分隔符、控制字符、盘符/ADS 都能改变最终落点。
            if (!IsValidWikiSegment(req.ProjectName))
                return Results.Problem("项目名非法：不能为空，且不能包含 / \\ : 控制字符、\"..\" 或以 . / 空格结尾", statusCode: 400);

            var targetFolder = req.TargetFolder ?? dept ?? "公共";
            if (!IsValidWikiSegment(targetFolder))
                return Results.Problem("目标目录非法：只允许单段目录名", statusCode: 400);
            if (!knowledge.CanAccess(targetFolder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var visibility = req.Visibility ?? "public";
            if (visibility is not "public" and not "department" and not "personal")
                return Results.Problem("Invalid visibility", statusCode: 400);

            var uid = GetUserId(user);
            var log = app.Services.GetRequiredService<LogService>();
            var actor = user.Identity?.Name ?? "unknown";

            // 「仅克隆」：只把源码拉下来、不跑 AI 生成（不花 token），任务以终结态入库
            if (req.CloneOnly)
            {
                var cloned = await generator.SubmitCloneOnly("git", req.Url, req.ProjectName, targetFolder, uid, visibility);
                if (!cloned.Ok)
                {
                    log.Warn("wiki", $"Clone-only git task failed: {req.ProjectName}");
                    return Results.Problem(cloned.Message, statusCode: 400);
                }
                var t = cloned.Task!;
                log.Info("wiki", $"Clone-only git task submitted: {req.ProjectName}");
                log.Audit("create", actor, targetType: "wiki-task", targetId: t.Id,
                    data: new { projectName = req.ProjectName, visibility, targetFolder, cloneOnly = true }, ipAddress: LogService.ClientIp(ctx), userId: uid);
                return Results.Ok(new { t.Id, t.Status, t.Visibility, cloneOnly = true });
            }

            var task = await generator.SubmitGit(req.Url, req.ProjectName, targetFolder, uid, visibility, req.Model, req.CustomCatalogJson);
            log.Info("wiki", $"Git task submitted: {req.ProjectName} (visibility={visibility})");
            log.Audit("create", actor, targetType: "wiki-task", targetId: task.Id,
                data: new { projectName = req.ProjectName, visibility, targetFolder }, ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Ok(new { task.Id, task.Status, task.Visibility });
        });

        wiki.MapPost("/submit-zip", async (IFormFile file, string projectName, string? targetFolder, string? visibility, string? model, string? customCatalogJson, bool? cloneOnly, ClaimsPrincipal user, WikiGeneratorService generator, AppDbContext db, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可提交", statusCode: 403);
            if (file is null || file.Length == 0) return Results.Problem("File required", statusCode: 400);
            if (file.Length > 100 * 1024 * 1024) return Results.Problem("Max 100MB", statusCode: 400);
            if (string.IsNullOrWhiteSpace(projectName)) return Results.Problem("Project name required", statusCode: 400);

            // FIX-02（审计 I-04）：同 submit-git，项目名/目标目录必须是单段名
            if (!IsValidWikiSegment(projectName))
                return Results.Problem("项目名非法：不能为空，且不能包含 / \\ : 控制字符、\"..\" 或以 . / 空格结尾", statusCode: 400);

            var folder = targetFolder ?? dept ?? "公共";
            if (!IsValidWikiSegment(folder))
                return Results.Problem("目标目录非法：只允许单段目录名", statusCode: 400);
            if (!knowledge.CanAccess(folder, role, dept))
                return Results.Problem("Access denied for target folder", statusCode: 403);

            var vis = visibility ?? "public";
            if (vis is not "public" and not "department" and not "personal")
                return Results.Problem("Invalid visibility", statusCode: 400);

            // 目录常量收敛到 SafeZipExtractor（保留期清理/任务删除清理都按同一目录判定）
            var zipDir = SafeZipExtractor.TempZipDir;
            Directory.CreateDirectory(zipDir);
            var zipPath = Path.Combine(zipDir, $"{Guid.NewGuid()}.zip");
            await using (var stream = File.Create(zipPath))
                await file.CopyToAsync(stream);

            var uid = GetUserId(user);
            var log = app.Services.GetRequiredService<LogService>();
            var actor = user.Identity?.Name ?? "unknown";

            // 「仅克隆」：只解压源码、不跑 AI 生成（不花 token），任务以终结态入库
            if (cloneOnly == true)
            {
                var cloned = await generator.SubmitCloneOnly("zip", WikiGeneratorService.EncodeZipSource(zipPath), projectName, folder, uid, vis);
                if (!cloned.Ok)
                {
                    log.Warn("wiki", $"Clone-only ZIP task failed: {projectName}");
                    return Results.Problem(cloned.Message, statusCode: 400);
                }
                var zt = cloned.Task!;
                log.Info("wiki", $"Clone-only ZIP task submitted: {projectName}");
                log.Audit("create", actor, targetType: "wiki-task", targetId: zt.Id,
                    data: new { projectName, visibility = vis, targetFolder = folder, cloneOnly = true }, ipAddress: LogService.ClientIp(ctx), userId: uid);
                return Results.Ok(new { zt.Id, zt.Status, zt.Visibility, cloneOnly = true });
            }

            var task = await generator.SubmitZip(zipPath, projectName, folder, uid, vis, model, customCatalogJson);
            log.Info("wiki", $"ZIP task submitted: {projectName} (visibility={vis})");
            log.Audit("create", actor, targetType: "wiki-task", targetId: task.Id,
                data: new { projectName, visibility = vis, targetFolder = folder }, ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Ok(new { task.Id, task.Status, task.Visibility });
        }).DisableAntiforgery();

        wiki.MapGet("/tasks", async (ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, WikiProgressTracker progress) =>
        {
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            var tasks = await generator.GetTasks();
            var filtered = tasks.Where(t =>
                t.Visibility == "public" ||
                (t.Visibility == "department" && (role == "admin" || dept == t.TargetFolder)) ||
                (t.Visibility == "personal" && (role == "admin" || t.UserId == uid))
            );
            return Results.Ok(filtered.Select(t => new
            {
                t.Id, t.Type, t.ProjectName, t.Status, t.ErrorMessage, t.Visibility, t.TargetFolder, t.CreatedAt, t.CompletedAt,
                Progress = progress.Get(t.Id)
            }));
        });

        wiki.MapGet("/tasks/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, WikiProgressTracker progress) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            return Results.Ok(new { task.Id, task.Type, task.ProjectName, task.Status, task.ErrorMessage, task.Visibility, task.TargetFolder, task.WorkspacePath, task.CatalogJson, task.CreatedAt, task.CompletedAt, Progress = progress.Get(task.Id) });
        });

        // Delete a wiki task
        wiki.MapDelete("/tasks/{id}", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, KnowledgeService knowledge, TrashService trash, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            var log = app.Services.GetRequiredService<LogService>();
            var actor = user.Identity?.Name ?? "unknown";

            var task = await generator.GetTask(id);
            if (task is null)
            {
                log.Warn("wiki", $"Wiki task {id} delete failed (not found) by {actor}");
                return Results.Problem("任务不存在", statusCode: 404);
            }

            // 删除会连知识库里的项目目录一起清掉 —— 先把目录整体搬进回收站（可恢复），再删任务行
            // ⚠️ 审计 #4：TargetFolder/ProjectName 来自任务创建时的用户输入，直接拼路径可把任意文件
            // （含线上 SQLite 主库）搬进回收站。必须规范化并断言**最终路径落在知识库根目录之内**；
            // 不用 StartsWith 前缀比较（审计 #33：前缀缺分隔符判定会误放行），按路径段用 GetRelativePath 判。
            var kbRoot = knowledge.BasePath;
            var folders = KnowledgePathGuard.ResolveAllInside(kbRoot, new[]
            {
                new[] { task.TargetFolder, task.ProjectName },
                new[] { task.TargetFolder, $"{task.ProjectName}_EN" },
            });
            if (folders is null)
            {
                log.Warn("wiki", $"Wiki task {id} delete rejected: illegal project path (folder={task.TargetFolder}, project={task.ProjectName}) by {actor}");
                return Results.Problem("项目路径非法（越出知识库目录），已拒绝删除", statusCode: 400);
            }
            db.TrashItems.Add(trash.StashPaths(folders, $"Wiki 项目：{task.ProjectName}", "WikiTask", uid, actor, row: task));
            await db.SaveChangesAsync();

            var ok = await generator.DeleteTask(id, knowledge);
            if (ok) log.Info("wiki", $"Wiki task {id} moved to trash by {actor}");
            else log.Warn("wiki", $"Wiki task {id} delete failed after stash by {actor}");

            // 审计 M-11：ZIP 源码包只在**任务删除时**立刻清理。
            // 不能在上传成功后立刻删 —— retry-missing / reclone 会拿 SourceUrl 里的路径重新解压；
            // 长期没人删的由 MaintenanceWorker 按保留期（7 天）兜底。
            if (ok && task.Type == "zip" && SafeZipExtractor.TryDeleteArchiveFromSource(task.SourceUrl))
                log.Info("wiki", $"Wiki task {id} source ZIP removed from temp storage");
            log.Audit("delete", actor, targetType: "wiki-task", targetId: id,
                data: new { success = ok, trash = true }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { success = true }) : Results.Problem("任务不存在", statusCode: 404);
        });

        // Update/review existing documents.
        // force=true 表示"用户已确认覆盖人工修改"；不带 force 且存在人工修改标记时返回 409，绝不直接覆盖。
        wiki.MapPost("/tasks/{id}/update", async (string id, bool? force, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可更新", statusCode: 403);
            var log = app.Services.GetRequiredService<LogService>();

            var edits = await generator.GetEditMarks(id);
            if (edits.Count > 0 && force != true)
            {
                log.Warn("wiki", $"Wiki task {id} update blocked: {edits.Count} manually edited document(s) need confirmation");
                return Results.Json(new
                {
                    detail = $"有 {edits.Count} 处文档已人工修改，重新生成会覆盖这些修改",
                    needConfirm = true,
                    modifiedCount = edits.Count,
                    paths = edits.Select(e => e.Path).Distinct().ToList(),
                }, statusCode: 409);
            }

            var ok = await generator.UpdateDocuments(id);
            var cleared = ok && force == true ? await generator.ClearEditMarks(id) : 0;
            if (ok) log.Info("wiki", $"Wiki task {id} document review started by {user.Identity?.Name} (cleared {cleared} manual-edit marks)");
            else log.Warn("wiki", $"Wiki task {id} update failed (not found or incomplete) by {user.Identity?.Name}");
            log.Audit("update", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: id,
                data: new { success = ok, forced = force == true, clearedEdits = cleared, reason = ok ? null : "任务不存在或未完成" }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { success = true, message = "文档审查已启动，完成后自动更新", clearedEdits = cleared })
                      : Results.Problem("任务不存在或未完成", statusCode: 400);
        });

        // 缺失文档预览：点「补齐」之前先告诉用户要补几篇（纯文件检查，不产生 AI 调用）
        wiki.MapGet("/tasks/{id}/missing", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            var info = await generator.GetMissingDocuments(id);
            if (info is null) return Results.Problem("Not found", statusCode: 404);
            return Results.Ok(new { total = info.Value.Total, missing = info.Value.Missing, missingCount = info.Value.Missing.Count });
        });

        // 诊断：文档该在哪、缺了哪些、哪些能从历史版本零成本恢复（纯文件检查，不产生 AI 调用）
        wiki.MapGet("/tasks/{id}/diagnose", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            var diag = await generator.DiagnoseTask(id);
            return diag is null ? Results.Problem("Not found", statusCode: 404) : Results.Ok(diag);
        });

        // 从知识库 .history 恢复缺失文档：不调用 AI，零成本
        wiki.MapPost("/tasks/{id}/restore-from-history", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            if (role != "admin" && role != "部长" && task.UserId != uid)
                return Results.Problem("仅任务提交者、管理员和部长可恢复文档", statusCode: 403);

            var result = await generator.RestoreMissingFromHistory(id);
            var log = app.Services.GetRequiredService<LogService>();
            log.Audit("restore-history", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: id,
                data: new { success = result.Ok, result.Missing, result.StillMissing }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = result.Ok, result.Missing, result.StillMissing, message = result.Message });
        });

        // 只补齐缺失的文档：复用已存目录与已有工作区，只有缺失项会调用 AI。
        // 大仓库的补写成本因此只与「缺了几篇」成正比，也不会重新 clone/上传源码。
        wiki.MapPost("/tasks/{id}/retry-missing", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            if (role != "admin" && role != "部长" && task.UserId != uid)
                return Results.Problem("仅任务提交者、管理员和部长可补齐文档", statusCode: 403);

            var result = await generator.RetryMissingDocuments(id, ctx.RequestAborted);
            var log = app.Services.GetRequiredService<LogService>();
            log.Info("wiki", $"Wiki task {id} retry-missing by {user.Identity?.Name}: missing={result.Missing}, stillMissing={result.StillMissing}");
            log.Audit("retry-missing", user.Identity?.Name ?? "unknown", targetType: "wiki-task", targetId: id,
                data: new { success = result.Ok, result.Missing, result.StillMissing }, ipAddress: LogService.ClientIp(ctx));
            return result.Ok
                ? Results.Ok(new { success = true, result.Missing, result.StillMissing, message = result.Message })
                : Results.Problem(result.Message, statusCode: 400);
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
            // 与写接口共用 DocKbPath（见 WikiEndpoints.DocWrite.cs），保证读写的是同一份文件
            var kbPath = DocKbPath(task, path, lang);
            // path 完全由客户端控制:必须过 CanAccess,否则可用 ../../../他部门/secret 读任意知识库文件
            if (!knowledge.CanAccess(kbPath, role, dept)) return Results.Problem("Access denied", statusCode: 403);
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
            var fbPath = DocKbPath(task, path, lang == "en" ? "zh" : "en");
            if (!knowledge.CanAccess(fbPath, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            var fbContent = knowledge.GetContent(fbPath);
            return fbContent is not null ? Results.Ok(new { path, content = fbContent }) : Results.Problem("Document not found", statusCode: 404);
        });

        // Source code file viewer
        wiki.MapGet("/tasks/{id}/blob/{**path}", async (string id, string path, HttpContext ctx, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null || string.IsNullOrEmpty(task.WorkspacePath)) return Results.Problem("Not found", statusCode: 404);
            // 工作区被保留策略清掉时给 404（与旧行为一致），不要因为"根不存在"报成 403
            if (!Directory.Exists(task.WorkspacePath)) return Results.Problem("Not found", statusCode: 404);
            var (role, dept) = await GetUserCtx(user, db);
            var uid = GetUserId(user);
            if (!CanViewTask(task, role, dept, uid)) return Results.Problem("Access denied", statusCode: 403);
            // FIX-02（审计 I-01）：只做字符串前缀比较挡不住符号链接 —— 克隆仓库里的 `leak -> /data`
            // 在字符串上位于工作区内，实际读到的却是库文件/令牌。必须解析**所有**链接后再断言归属。
            var fullPath = WorkspacePathGuard.TryResolveInside(task.WorkspacePath, path);
            if (fullPath is null) return Results.Problem("Access denied", statusCode: 403);
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
                var html = $@"<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'><title>{System.Net.WebUtility.HtmlEncode(path)} — {System.Net.WebUtility.HtmlEncode(task.ProjectName ?? "")}</title>
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

        // 源码工作区恢复（重新克隆）—— 见 WikiEndpoints.Recovery.cs
        MapWorkspaceRecoveryEndpoints(wiki);
        // 文档写接口 + 人工修改标记 —— 见 WikiEndpoints.DocWrite.cs
        MapDocWriteEndpoints(wiki);
    }

    /// <summary>
    /// FIX-02（审计 I-04）：Wiki 项目名 / 目标目录的**单段白名单**。
    ///
    /// 这两个值会被拼进知识库文档路径、回收站源路径与文档写入路径 —— 一个 `..` 或分隔符
    /// 就足以把写入/删除引到别的部门目录，甚至知识库根之外。规则刻意保守：只接受普通单段目录名。
    /// </summary>
    internal static bool IsValidWikiSegment(string? segment)
    {
        if (string.IsNullOrWhiteSpace(segment)) return false;
        if (segment.Length > 80) return false;
        if (segment is "." or "..") return false;
        if (segment.Trim() != segment) return false;                 // 首尾空白：目录名与界面显示会不一致
        if (segment.IndexOfAny(new[] { '/', '\\', ':', '\0' }) >= 0) return false;  // 分隔符 / 盘符 / ADS
        if (segment.Any(char.IsControl)) return false;               // 换行等控制字符（也是日志/CSV 注入面）
        if (segment.EndsWith('.')) return false;                     // Windows 不允许目录名以点结尾
        return true;
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

public record GitSubmitRequest(string Url, string ProjectName, string? TargetFolder, string? Visibility, string? Model = null, string? CustomCatalogJson = null, bool CloneOnly = false);
public record VisibilityRequest(string Visibility);
