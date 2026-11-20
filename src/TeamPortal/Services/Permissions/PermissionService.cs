using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services.Permissions;

/// <summary>
/// 角色 → 权限的运行期视图：默认矩阵 + 数据库覆盖，进程内缓存。
///
/// 同步的 Has() 供授权处理器使用（不能在那里 await），所以这里把整张矩阵
/// 缓存在内存里；任何保存操作完成后立即 Reload。
/// </summary>
public class PermissionService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<PermissionService> _logger;
    private volatile IReadOnlyDictionary<string, HashSet<string>> _matrix = Empty;

    private static readonly IReadOnlyDictionary<string, HashSet<string>> Empty =
        new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

    public PermissionService(IServiceScopeFactory scopes, ILogger<PermissionService> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    public bool Has(string? role, string permission) =>
        role is not null
        && _matrix.TryGetValue(role, out var set)
        && set.Contains(permission);

    public IReadOnlyCollection<string> For(string role) =>
        _matrix.TryGetValue(role, out var set) ? set : Array.Empty<string>();

    public async Task ReloadAsync()
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.RolePermissions.AsNoTracking().ToListAsync();
            _matrix = Build(rows);
        }
        catch (Exception ex)
        {
            // 读取失败不能让整个进程挂掉：沿用旧矩阵（首次启动则用默认矩阵）
            _logger.LogError(ex, "加载角色权限失败，沿用当前矩阵");
            if (_matrix.Count == 0) _matrix = Build(Array.Empty<RolePermission>());
        }
    }

    private static Dictionary<string, HashSet<string>> Build(IReadOnlyCollection<RolePermission> rows)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var role in PermissionCatalog.Roles)
        {
            var set = new HashSet<string>(PermissionCatalog.Defaults[role], StringComparer.Ordinal);
            foreach (var row in rows.Where(r => r.Role == role))
            {
                if (row.Allowed) set.Add(row.Permission);
                else set.Remove(row.Permission);
            }
            result[role] = set;
        }
        return result;
    }

    /// <summary>与默认值一致的改动不落库（删行即默认），避免覆盖表膨胀</summary>
    public async Task SaveAsync(IEnumerable<(string Role, string Permission, bool Allowed)> changes, int? userId)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var list = changes.ToList();
        var keys = list.Select(c => new { c.Role, c.Permission }).ToList();
        var existing = await db.RolePermissions.ToListAsync();
        var now = DateTime.UtcNow;

        foreach (var change in list)
        {
            var row = existing.FirstOrDefault(r => r.Role == change.Role && r.Permission == change.Permission);
            var isDefault = PermissionCatalog.Defaults.TryGetValue(change.Role, out var defaults)
                && defaults.Contains(change.Permission) == change.Allowed;

            if (isDefault)
            {
                if (row is not null) db.RolePermissions.Remove(row);
                continue;
            }

            if (row is null)
            {
                row = new RolePermission { Role = change.Role, Permission = change.Permission };
                db.RolePermissions.Add(row);
            }
            row.Allowed = change.Allowed;
            row.UpdatedByUserId = userId;
            row.UpdatedAt = now;
        }

        await db.SaveChangesAsync();
        await ReloadAsync();
    }

    /// <summary>恢复某个角色的全部默认（删掉它的所有覆盖行）</summary>
    public async Task ResetRoleAsync(string role)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.RolePermissions.Where(r => r.Role == role).ExecuteDeleteAsync();
        await ReloadAsync();
    }
}
