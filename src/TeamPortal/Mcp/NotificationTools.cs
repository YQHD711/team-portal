using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 通知工具。读取类动作按当前用户身份过滤(服务层已按 uid/role 裁剪);
/// notification_send 是 HTTP 侧并不存在的额外能力(可直接广播给 admin/staff 全体),
/// 因此限定 staff,避免成员伪造公告钓鱼。
/// </summary>
[McpServerToolType]
public class NotificationTools
{
    private readonly NotificationService _notify;
    private readonly IHttpContextAccessor _http;
    public NotificationTools(NotificationService notify, IHttpContextAccessor http) { _notify = notify; _http = http; }

    private (int uid, string? role) GetUser() => (McpAuth.UserId(_http), McpAuth.Role(_http));

    [McpServerTool(Name = "notification_list")]
    public async Task<object> List(bool unreadOnly = false) { var (u, r) = GetUser(); return await _notify.GetNotifications(u, r, unreadOnly); }
    [McpServerTool(Name = "notification_unread_count")]
    public async Task<int> UnreadCount() { var (u, r) = GetUser(); return await _notify.GetUnreadCount(u, r); }
    [McpServerTool(Name = "notification_mark_read")]
    public async Task MarkRead(long id) { var (u, r) = GetUser(); await _notify.MarkReadIfVisible(id, u, r); }
    [McpServerTool(Name = "notification_mark_all_read")]
    public async Task MarkAllRead() { var (u, r) = GetUser(); await _notify.MarkAllRead(u, r); }
    [McpServerTool(Name = "notification_send")]
    public string Send(string title, string message, string? link = null, int? userId = null, string? targetRole = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        _notify.Notify(title, message, link, userId, targetRole);
        return "ok";
    }
}
