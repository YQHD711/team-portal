using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;
using TeamPortal.Services.Permissions;

namespace TeamPortal.Endpoints;

/// <summary>
/// 权限矩阵：本人权限（前端菜单/按钮按它渲染）与管理员维护入口。
/// 注意本组自身由权限点 admin.permissions.manage 保护，且不允许把 admin 的这项关掉。
/// </summary>
public static class PermissionEndpoints
{
    public static void MapPermissionEndpoints(this WebApplication app)
    {
        app.MapGet("/api/me/permissions", (ClaimsPrincipal user, PermissionService perms) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            return Results.Ok(new { role, permissions = perms.For(role ?? string.Empty) });
        }).RequireAuthorization();

        var admin = app.MapGroup("/api/admin/permissions").RequireAuthorization("perm:admin.permissions.manage");

        admin.MapGet("", async (PermissionService perms, AppDbContext db) =>
        {
            var overrides = await db.RolePermissions.AsNoTracking().ToListAsync();
            return Results.Ok(new
            {
                roles = PermissionCatalog.Roles,
                groups = PermissionCatalog.ByGroup()
                    .GroupBy(p => p.Group)
                    .Select(g => new
                    {
                        group = g.Key,
                        items = g.Select(p => new { key = p.Key, label = p.Label, desc = p.Desc }).ToList(),
                    })
                    .ToList(),
                matrix = PermissionCatalog.Roles.ToDictionary(
                    r => r,
                    r => PermissionCatalog.All.ToDictionary(p => p.Key, p => perms.Has(r, p.Key))),
                defaults = PermissionCatalog.Roles.ToDictionary(
                    r => r,
                    r => PermissionCatalog.Defaults[r]),
                overrides = overrides.Select(o => new { o.Role, o.Permission, o.Allowed }).ToList(),
            });
        });

        admin.MapPut("", async (PermissionChange[]? changes, ClaimsPrincipal user, PermissionService perms,
            AppDbContext db, LogService log, HttpContext ctx) =>
        {
            if (changes is null || changes.Length == 0)
                return Results.Problem("没有要保存的修改", statusCode: 400);
            if (changes.Length > 500) return Results.Problem("单次最多 500 条", statusCode: 400);

            if (changes.Any(c => c.Role == "admin" && c.Permission == "admin.permissions.manage" && !c.Allowed))
                return Results.Problem("不能收回管理员自己的「权限管理」权限，否则将无人能再修改权限", statusCode: 400);

            var invalidRole = changes.FirstOrDefault(c => !PermissionCatalog.Roles.Contains(c.Role));
            if (invalidRole is not null) return Results.Problem($"未知角色：{invalidRole.Role}", statusCode: 400);
            var invalidPerm = changes.FirstOrDefault(c => PermissionCatalog.All.All(p => p.Key != c.Permission));
            if (invalidPerm is not null) return Results.Problem($"未知权限：{invalidPerm.Permission}", statusCode: 400);

            var actorId = int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (int?)null;
            await perms.SaveAsync(changes.Select(c => (c.Role, c.Permission, c.Allowed)), actorId);

            log.Audit("permission.update", user.Identity?.Name ?? "unknown", targetType: "permissions",
                data: new { count = changes.Length, keys = changes.Take(20).Select(c => c.Role + ":" + c.Permission + "=" + c.Allowed) },
                ipAddress: LogService.ClientIp(ctx), userId: actorId);
            return Results.Ok(new { saved = changes.Length });
        });

        admin.MapDelete("/{role}", async (string role, PermissionService perms) =>
        {
            if (!PermissionCatalog.Roles.Contains(role)) return Results.Problem("未知角色", statusCode: 400);
            await perms.ResetRoleAsync(role);
            return Results.Ok(new { role, reset = true });
        });
    }
}

/// <summary>一条权限变更：Allowed=false 表示收回（覆盖默认的授予）</summary>
public sealed record PermissionChange(string Role, string Permission, bool Allowed);
