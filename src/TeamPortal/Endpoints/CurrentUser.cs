using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Endpoints;

/// <summary>
/// 从数据库读调用者的**当前**角色与部门。
///
/// 为什么不直接用 JWT 里的 Role / Department 声明做可见性判断：
/// 全仓没有 token 失效机制，而 token 默认活 7 天（Auth:JwtExpireDays）。
/// 于是改角色 / 改部门之后，旧 token 会带着**旧身份**继续用满 7 天 ——
/// 被免职的部长仍以部长身份可见范围、换部门的人仍搜得到原部门的文档。
/// 其余 HTTP 端点本来就是查库取部门的，这里把漏网的两处（搜索、AI 检索）补上。
///
/// 注：这只修「数据可见性」这一半。`RequireAuthorization("StaffOnly")` 这类
/// **授权策略**仍然读 token 声明，那需要 token 失效机制才能根治 —— 另议。
/// </summary>
internal static class CurrentUser
{
    public static async Task<(string? Role, string? Department, int Id)> FromDbAsync(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null || !int.TryParse(idClaim, out var id)) return (null, null, 0);

        var u = await db.Users.AsNoTracking()
            .Include(x => x.Department)
            .FirstOrDefaultAsync(x => x.Id == id);

        // 用户已被删除 → 身份为空，调用方按其可见范围为空处理
        return u is null ? (null, null, 0) : (u.Role, u.Department?.Name, u.Id);
    }
}
