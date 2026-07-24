using System.Security.Claims;
using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class NotificationTools
{
    private readonly NotificationService _notify;
    private readonly IHttpContextAccessor _http;
    public NotificationTools(NotificationService notify, IHttpContextAccessor http) { _notify = notify; _http = http; }
    private (int uid, string? role) GetUser() { var u = _http.HttpContext?.User; int.TryParse(u?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id); return (id, u?.FindFirst(ClaimTypes.Role)?.Value); }

    [McpServerTool(Name = "notification_list")]
    public async Task<object> List(bool unreadOnly = false) { var (u, r) = GetUser(); return await _notify.GetNotifications(u, r, unreadOnly); }
    [McpServerTool(Name = "notification_unread_count")]
    public async Task<int> UnreadCount() { var (u, r) = GetUser(); return await _notify.GetUnreadCount(u, r); }
    [McpServerTool(Name = "notification_mark_read")]
    public async Task MarkRead(long id) => await _notify.MarkRead(id);
    [McpServerTool(Name = "notification_mark_all_read")]
    public async Task MarkAllRead() { var (u, r) = GetUser(); await _notify.MarkAllRead(u, r); }
    [McpServerTool(Name = "notification_send")]
    public void Send(string title, string message, string? link = null, int? userId = null, string? targetRole = null) => _notify.Notify(title, message, link, userId, targetRole);
}
