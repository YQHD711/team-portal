using System.Security.Claims;
using System.Text;
using System.Text.Json;
using TeamPortal.Data.Models;
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

        // SSE 实时推送:浏览器 fetch + ReadableStream 消费,不能用 EventSource(无法自定义 Authorization 头)
        n.MapGet("/stream", async (HttpContext ctx, NotificationService svc, ClaimsPrincipal user) =>
        {
            var uid = GetUserId(user);
            var role = GetUserRole(user);

            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = "text/event-stream; charset=utf-8";
            ctx.Response.Headers["Cache-Control"] = "no-cache, no-transform";
            ctx.Response.Headers["Connection"] = "keep-alive";
            // nginx 反代必须显式禁用缓冲
            ctx.Response.Headers["X-Accel-Buffering"] = "no";
            // 立即 flush 首部,避免中间代理等待
            await ctx.Response.Body.FlushAsync();

            var subscription = svc.Subscribe(uid, role, out var reader);

            // 1. 先发最近的 50 条作为初始 backlog
            var backlog = await svc.GetNotifications(uid, role);
            foreach (var n in backlog)
                await WriteSseEventAsync(ctx.Response.Body, n);

            // 2. 30 秒心跳保活(防 nginx/proxy 超时断连)
            using var heartbeat = new PeriodicTimer(TimeSpan.FromSeconds(30));
            var cts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);

            try
            {
                await ctx.Response.Body.FlushAsync();
                while (!cts.Token.IsCancellationRequested)
                {
                    // 同时等心跳或新事件(任一即返回)
                    var waitEvent = reader.WaitToReadAsync(cts.Token).AsTask();
                    var waitHeartbeat = heartbeat.WaitForNextTickAsync(cts.Token).AsTask();
                    var first = await Task.WhenAny(waitEvent, waitHeartbeat);
                    if (first == waitHeartbeat)
                    {
                        await ctx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(": heartbeat\n\n"), cts.Token);
                        await ctx.Response.Body.FlushAsync(cts.Token);
                        continue;
                    }
                    // 新事件
                    while (reader.TryRead(out var item))
                        await WriteSseEventAsync(ctx.Response.Body, item);
                    await ctx.Response.Body.FlushAsync(cts.Token);
                }
            }
            catch (OperationCanceledException) { /* client disconnect */ }
            finally
            {
                subscription.Dispose();
            }
        });

        static async Task WriteSseEventAsync(Stream body, Notification n)
        {
            var json = JsonSerializer.Serialize(n, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
            // SSE 格式:event/data/id + 空行
            var payload = Encoding.UTF8.GetBytes($"event: notification\ndata: {json}\nid: {n.Id}\n\n");
            await body.WriteAsync(payload);
        }
    }
}
