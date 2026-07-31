using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class NotificationEndpoints
{
    private static int GetUserId(ClaimsPrincipal user)
    {
        var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is not null ? int.Parse(id) : 0;
    }

    private static string? GetUserRole(ClaimsPrincipal user)
        => user.FindFirstValue(ClaimTypes.Role);

    public static void MapNotificationEndpoints(this WebApplication app)
    {
        var n = app.MapGroup("/api/notifications").RequireAuthorization();

        n.MapGet("/", async (ClaimsPrincipal user, NotificationService svc) =>
            Results.Ok(await svc.GetNotifications(GetUserId(user), GetUserRole(user))));

        n.MapGet("/unread-count", async (ClaimsPrincipal user, NotificationService svc) =>
            Results.Ok(new { count = await svc.GetUnreadCount(GetUserId(user), GetUserRole(user)) }));

        n.MapPost("/{id:long}/read", async (long id, ClaimsPrincipal user, NotificationService svc) =>
        {
            var ok = await svc.MarkReadIfVisible(id, GetUserId(user), GetUserRole(user));
            return ok ? Results.Ok(new { success = true }) : Results.NotFound();
        });

        n.MapPost("/read-all", async (ClaimsPrincipal user, NotificationService svc) =>
            { await svc.MarkAllRead(GetUserId(user), GetUserRole(user)); return Results.Ok(new { success = true }); });
    }
}
