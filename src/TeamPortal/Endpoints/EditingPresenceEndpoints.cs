using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 「谁正在编辑房间布局」的在线状态端点（心跳 + 轮询，不用 WebSocket）。
///
/// 权限与编辑权限一致（<see cref="CurrentUser.IsStaffRole"/> —— **同一份判定，不写第二遍**）：
/// 只有能改布局的人才会被算作"正在编辑"，避免普通成员打开只读视图时也冒出一条"某某正在编辑"。
///
/// 契约：
///   POST   /api/storage/layouts/{id:int}/editing   → 心跳（并返回当前编辑者）
///   GET    /api/storage/layouts/{id:int}/editing   → 轮询当前编辑者（**无人时 editors 为空数组**）
///   DELETE /api/storage/layouts/{id:int}/editing   → 离开页面/保存后立刻清除自己
/// 返回体：{ editors: [{ userId, name, since, expiresAt }], ttlSeconds }
/// </summary>
public static class EditingPresenceEndpoints
{
    public static void MapEditingPresenceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/storage/layouts/{id:int}/editing").RequireAuthorization();

        group.MapPost("/", async (int id, ClaimsPrincipal user, AppDbContext db, EditingPresenceService presence) =>
        {
            var (role, _, userId) = await CurrentUser.FromDbAsync(user, db);
            if (!CurrentUser.IsStaffRole(role)) return Results.Problem("仅管理员和部长可编辑库位布局", statusCode: 403);
            if (!await db.StorageLayouts.AnyAsync(l => l.Id == id)) return Results.Problem("布局不存在", statusCode: 404);

            var editors = presence.Heartbeat(id, userId, user.Identity?.Name ?? "unknown");
            return Results.Ok(Payload(editors, presence.Ttl));
        });

        group.MapGet("/", async (int id, ClaimsPrincipal user, AppDbContext db, EditingPresenceService presence) =>
        {
            var (role, _, _) = await CurrentUser.FromDbAsync(user, db);
            if (!CurrentUser.IsStaffRole(role)) return Results.Problem("仅管理员和部长可查看编辑状态", statusCode: 403);
            // 房间可能刚被删：这不算错误，直接回空列表（前端"无人在线就不显示"）
            var editors = await db.StorageLayouts.AnyAsync(l => l.Id == id)
                ? presence.Editors(id)
                : Array.Empty<EditingPresenceService.EditorState>();
            return Results.Ok(Payload(editors, presence.Ttl));
        });

        group.MapDelete("/", async (int id, ClaimsPrincipal user, AppDbContext db, EditingPresenceService presence) =>
        {
            var (_, _, userId) = await CurrentUser.FromDbAsync(user, db);
            presence.Leave(id, userId);
            return Results.Ok(new { left = true });
        });
    }

    private static object Payload(IReadOnlyList<EditingPresenceService.EditorState> editors, TimeSpan ttl) => new
    {
        editors = editors.Select(e => new { userId = e.UserId, name = e.Name, since = e.SinceUtc, expiresAt = e.ExpiresAtUtc }),
        ttlSeconds = (int)ttl.TotalSeconds
    };
}
