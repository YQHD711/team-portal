using System.Security.Claims;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// Wiki 文档写接口（块级就地编辑的后端）。
///
/// 文档正文存在**知识库**里（`GET /tasks/{id}/doc` 读的就是那份，不是源码工作区）；
/// 写接口写同一份文件，路径解析与权限判定完全复用 GET 那套（<see cref="DocKbPath"/> + knowledge.CanAccess），
/// 不另写一套前缀比较。
///
/// 写成功会给文档打「已人工修改」标记；`POST /tasks/{id}/update` 检测到标记先要求确认，
/// 免得重新生成把人工修改冲掉（方案 c）。
/// </summary>
public static partial class WikiEndpoints
{
    /// <summary>文档在知识库里的相对路径（zh/en 两套目录）。GET 与 PUT 共用，避免读写指到不同文件。</summary>
    private static string DocKbPath(WikiTask task, string path, string? lang) =>
        $"{task.TargetFolder}/{(lang == "en" ? $"{task.ProjectName}_EN" : task.ProjectName)}/{path}.md".Replace("//", "/");

    internal static void MapDocWriteEndpoints(RouteGroupBuilder wiki)
    {
        // 写单篇文档：只允许 staff（与 POST /tasks/{id}/update、知识库写入一致，不放宽）
        wiki.MapPut("/tasks/{id}/doc", async (string id, WikiDocWriteRequest req, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, KnowledgeService knowledge, HttpContext ctx) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            if (string.IsNullOrWhiteSpace(req.Path)) return Results.Problem("path required", statusCode: 400);
            if (req.Content is null) return Results.Problem("content required", statusCode: 400);

            var (role, dept) = await GetUserCtx(user, db);
            var lang = req.Lang == "en" ? "en" : "zh";
            var kbPath = DocKbPath(task, req.Path, lang);
            if (!knowledge.CanAccess(kbPath, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            // 只允许改本任务目录里声明过的文档：部门前缀放行 ≠ 能改同部门另一个项目的文档
            if (!generator.IsCatalogDocument(task, req.Path)) return Results.Problem("文档不存在", statusCode: 404);

            var log = ctx.RequestServices.GetRequiredService<LogService>();
            var actor = user.Identity?.Name ?? "unknown";
            var savedAt = DateTime.UtcNow;
            try
            {
                // 原子写 + 覆盖前自动留 .history 备份；抛异常时会清掉临时文件，原文件保持完好
                knowledge.WriteFile(kbPath, req.Content);
                await generator.MarkDocumentEdited(task.Id, req.Path, lang, GetUserId(user), actor);
            }
            catch (Exception ex)
            {
                log.Error("wiki", $"Wiki doc write failed: {kbPath}", ex.ToString());
                return Results.Problem($"写入失败：{ex.Message}", statusCode: 500);
            }

            log.Info("wiki", $"Wiki doc edited: {kbPath} by {actor}");
            log.Audit("edit-doc", actor, targetType: "wiki-doc", targetId: $"{task.Id}:{lang}:{req.Path}",
                data: new { taskId = task.Id, path = req.Path, lang }, ipAddress: LogService.ClientIp(ctx), userId: GetUserId(user));
            return Results.Ok(new { ok = true, savedAt, path = req.Path, lang, marked = true });
        }).RequireAuthorization("StaffOnly");

        // 人工修改标记列表：前端在「检查修正」之前先问一下，有标记就弹确认框
        wiki.MapGet("/tasks/{id}/edits", async (string id, WikiGeneratorService generator) =>
        {
            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("Not found", statusCode: 404);
            var edits = await generator.GetEditMarks(id);
            return Results.Ok(new { count = edits.Count, paths = edits.Select(e => e.Path).Distinct().ToList(), edits });
        }).RequireAuthorization("StaffOnly");
    }
}

/// <summary>写单篇 Wiki 文档的请求体（field 可空是为了区分"没传"与"传了空串"）。</summary>
public record WikiDocWriteRequest(string? Path, string? Lang, string? Content);
