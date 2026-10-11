using System.Security.Claims;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 聊天空会话的「建议问题」端点（task-14，契约由 Lead 冻结）：
/// <code>GET /api/ai/suggestions → 200 { suggestions: [ { text, kind } ] }</code>
/// kind ∈ doc / study；内容不足时可以少给；失败/无内容一律 200 + 空数组（前端有兜底，不要 500）。
/// 挂在 /api/ai 组里（RequireAuthorization + default 限流），身份查库取当前值。
/// </summary>
public static partial class AiEndpoints
{
    internal static void MapSuggestionEndpoints(RouteGroupBuilder group)
    {
        group.MapGet("/suggestions", async (ClaimsPrincipal user, AppDbContext db, AiSuggestionService suggestions, LogService log) =>
        {
            try
            {
                var (role, dept, uid) = await CurrentUser.FromDbAsync(user, db);
                return Results.Ok(new { suggestions = await suggestions.BuildAsync(role, dept, uid) });
            }
            catch (Exception ex)
            {
                // 建议问题只是锦上添花：任何异常都返回空数组，不能连累聊天页
                log.Warn("ai", $"Suggestions failed: {ex.Message}");
                return Results.Ok(new { suggestions = Array.Empty<object>() });
            }
        });
    }
}
