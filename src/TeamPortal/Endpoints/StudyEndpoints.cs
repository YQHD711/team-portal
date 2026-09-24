using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 学习库：结构 + 进度。
///
/// 课时正文不经过这里 —— 前端复用既有的 /api/knowledge/content，
/// 于是可见性判定与知识库完全同一套 ACL，不存在第二处权限实现。
/// 这里只额外带「下划线说明文件」的正文/元信息（卡片要展示）与本人的完成情况。
/// </summary>
public static class StudyEndpoints
{
    private static async Task<(string? role, string? dept, int id)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null, 0);
        // 查库而非读 JWT 声明：部门可能被改过，声明会过期，权限判定必须用当前值
        var u = await db.Users.Include(x => x.Department).FirstOrDefaultAsync(x => x.Id == int.Parse(idClaim));
        return u is null ? (null, null, 0) : (u.Role, u.Department?.Name, u.Id);
    }

    public static void MapStudyEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/study").RequireAuthorization();

        group.MapGet("/library", async (ClaimsPrincipal user, KnowledgeService knowledge,
            StudyProgressService progress, AppDbContext db) =>
        {
            var (role, dept, uid) = await GetUserCtx(user, db);
            var completed = await progress.GetCompletedPaths(uid);
            var tree = knowledge.GetTree(role, dept, uid);
            var scopes = StudyLibraryService.Build(tree, role, dept)
                .Select(s => WithProgress(Enrich(s, knowledge), completed))
                .ToList();
            return Results.Ok(new { scopes });
        });

        group.MapPost("/progress", async (StudyProgressReq req, ClaimsPrincipal user, KnowledgeService knowledge,
            StudyProgressService progress, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            var (role, dept, uid) = await GetUserCtx(user, db);
            if (uid == 0) return Results.Problem("未登录", statusCode: 401);

            // 只允许勾选「本人可见的真实课时」：用同一棵 ACL 过滤后的树校验，
            // 不另写一套判断，也就不会出现"进度接口自己放宽了可见性"。
            var tree = knowledge.GetTree(role, dept, uid);
            var valid = StudyLibraryService.Build(tree, role, dept)
                .SelectMany(s => s.Stages).SelectMany(st => st.Lessons)
                .Any(l => l.Path == req.Path);
            if (!valid) return Results.Problem("不是有效的学习库课时", statusCode: 400);

            await progress.SetCompleted(uid, req.Path, req.Completed);
            log.Audit(req.Completed ? "complete" : "uncomplete", user.Identity?.Name ?? "unknown",
                targetType: "study", targetId: req.Path,
                data: new { completed = req.Completed }, ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Ok(new { path = req.Path, completed = req.Completed });
        });

        // 完成情况：部长看「公共 + 本部门」，管理员看全部
        group.MapGet("/stats", async (string scope, ClaimsPrincipal user, KnowledgeService knowledge,
            StudyProgressService progress, AppDbContext db) =>
        {
            var (role, dept, uid) = await GetUserCtx(user, db);
            if (!CanViewScopeStats(scope, role, dept))
                return Results.Problem("仅管理员和本部门部长可查看完成情况", statusCode: 403);

            var tree = knowledge.GetTree(role, dept, uid);
            var target = StudyLibraryService.Build(tree, role, dept).FirstOrDefault(s => s.Scope == scope);
            if (target is null) return Results.Problem("Not found", statusCode: 404);

            var counts = await progress.GetCompletionCounts(scope);
            var members = await progress.CountScopeMembers(scope);
            var lessons = target.Stages.SelectMany(st => st.Lessons)
                .Select(l => new { l.Title, l.Path, CompletedCount = counts.GetValueOrDefault(l.Path) });
            return Results.Ok(new { scope, memberCount = members, lessons });
        });
    }

    /// <summary>谁能看某范围的完成情况：admin 全部；部长仅公共 + 本部门；队员不可。</summary>
    internal static bool CanViewScopeStats(string scope, string? role, string? dept)
        => role == "admin"
           || (role == "部长" && (scope == StudyLibraryService.PublicScope
                                  || (dept is not null && scope == dept)));

    /// <summary>
    /// 读入「_学习路径.md」「_阶段说明.md」的正文与 front matter 元信息。
    /// 这些路径全部来自**已按 ACL 过滤**的树，因此不会越权读取；
    /// 且统一走 KnowledgeService.GetContent（内含 ResolvePath 的路径安全校验）。
    /// </summary>
    internal static StudyScope Enrich(StudyScope scope, KnowledgeService knowledge)
    {
        var (scopeMeta, scopeBody) = StudyLibraryService.ParseDoc(
            scope.OverviewPath is null ? null : knowledge.GetContent(scope.OverviewPath));

        return scope with
        {
            Overview = Blank(scopeBody),
            Duration = StudyLibraryService.MetaValue(scopeMeta, "时长", "duration"),
            Goal = StudyLibraryService.MetaValue(scopeMeta, "目标", "goal"),
            Stages = scope.Stages.Select(stage =>
            {
                var (meta, body) = StudyLibraryService.ParseDoc(
                    stage.DescriptionPath is null ? null : knowledge.GetContent(stage.DescriptionPath));
                return stage with
                {
                    Description = Blank(body),
                    Duration = StudyLibraryService.MetaValue(meta, "时长", "duration"),
                    Goal = StudyLibraryService.MetaValue(meta, "目标", "goal"),
                };
            }).ToList()
        };
    }

    /// <summary>把本人进度映射进结构（纯函数，便于单测）。</summary>
    internal static StudyScope WithProgress(StudyScope scope, HashSet<string> completed)
    {
        var stages = scope.Stages.Select(stage =>
        {
            var lessons = stage.Lessons.Select(l => l with { Completed = completed.Contains(l.Path) }).ToList();
            return stage with { Lessons = lessons, CompletedCount = lessons.Count(l => l.Completed) };
        }).ToList();

        return scope with
        {
            Stages = stages,
            CompletedCount = stages.Sum(s => s.CompletedCount),
            LessonCount = stages.Sum(s => s.Lessons.Count),
        };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}

public record StudyProgressReq(string Path, bool Completed);
