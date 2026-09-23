using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 学习库：只读的结构接口（阶段/课时/可编辑标记）。
/// 内容本身不经过这里 —— 前端复用既有的 /api/knowledge/content，
/// 于是可见性判定与知识库完全同一套 ACL，不存在第二处权限实现。
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
            return Results.Ok(new { scopes = StudyLibraryService.Build(tree, role, dept) });
        });
    }
}
