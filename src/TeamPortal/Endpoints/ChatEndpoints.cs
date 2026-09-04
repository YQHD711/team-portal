using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class ChatEndpoints
{
    public static void MapChatEndpoints(this WebApplication app)
    {
        var chat = app.MapGroup("/api/chat").RequireAuthorization();

        // List user's conversation sessions
        chat.MapGet("/sessions", async (ClaimsPrincipal user, ConversationService svc) =>
        {
            var name = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            return Results.Ok(await svc.ListSessions(name));
        });

        // Get conversation history (context)
        chat.MapGet("/sessions/{sessionId}", async (string sessionId, ClaimsPrincipal user, ConversationService svc) =>
        {
            var userName = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            var messages = await svc.GetContext(sessionId, userName);
            if (messages.Count == 0)
                return Results.Ok(new List<object>()); // not owner or empty
            return Results.Ok(messages.Select(m => new { m.Role, m.Content, m.CreatedAt }));
        });

        // Delete a conversation
        chat.MapDelete("/sessions/{sessionId}", async (string sessionId, ClaimsPrincipal user, ConversationService svc) =>
        {
            var userName = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            var ok = await svc.DeleteSession(sessionId, userName);
            return ok ? Results.Ok(new { success = true }) : Results.Problem("无权删除此会话", statusCode: 403);
        });

        // Generate a new session ID
        chat.MapGet("/new-session", () =>
            Results.Ok(new { sessionId = Guid.NewGuid().ToString("N")[..12] }));
    }
}
