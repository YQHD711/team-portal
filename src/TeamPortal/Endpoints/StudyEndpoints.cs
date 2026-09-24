using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 学习库：只读接口（学习路径 + 阶段 + 课时 + 可编辑标记）。
///
/// 课时正文不经过这里 —— 前端复用既有的 /api/knowledge/content，
/// 于是可见性判定与知识库完全同一套 ACL，不存在第二处权限实现。
/// 这里只额外带上「下划线说明文件」的正文与元信息（阶段目标/时长），
/// 因为卡片要展示它们，逐个再发请求太碎。
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

        group.MapGet("/library", async (ClaimsPrincipal user, KnowledgeService knowledge, AppDbContext db) =>
        {
            var (role, dept, uid) = await GetUserCtx(user, db);
            var tree = knowledge.GetTree(role, dept, uid);
            var scopes = StudyLibraryService.Build(tree, role, dept)
                .Select(s => Enrich(s, knowledge))
                .ToList();
            return Results.Ok(new { scopes });
        });
    }

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

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
