using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class NotificationEndpoints
{
    public static void MapNotificationEndpoints(this WebApplication app)
    {
        var n = app.MapGroup("/api/notifications").RequireAuthorization();

        n.MapGet("/", async (NotificationService svc) => Results.Ok(await svc.GetNotifications(false)));
        n.MapGet("/unread-count", async (NotificationService svc) => Results.Ok(new { count = await svc.GetUnreadCount() }));
        n.MapPost("/{id:long}/read", async (long id, NotificationService svc) => { await svc.MarkRead(id); return Results.Ok(new { success = true }); });
        n.MapPost("/read-all", async (NotificationService svc) => { await svc.MarkAllRead(); return Results.Ok(new { success = true }); });
    }
}
