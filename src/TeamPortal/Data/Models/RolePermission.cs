namespace TeamPortal.Data.Models;

/// <summary>
/// 角色权限的**覆盖值**：只有管理员改过的 (Role, Permission) 才有一行。
///
/// 没有行 = 用 PermissionCatalog.Defaults 里的默认值；所以「恢复默认」就是删行，
/// 以后调整默认矩阵也不会被旧数据锁住。
/// </summary>
public class RolePermission
{
    /// <summary>角色：member / 部长 / admin</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>权限 key，例如 material.inventory.manage</summary>
    public string Permission { get; set; } = string.Empty;

    /// <summary>true=授予，false=收回（不能只存授予，否则无法表达"从默认里拿掉"）</summary>
    public bool Allowed { get; set; }

    public int? UpdatedByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
