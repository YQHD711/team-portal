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
        chat.MapGet("/sessions/{sessionId}", async (string sessionId, ConversationService svc) =>
        {
            var messages = await svc.GetContext(sessionId);
            return Results.Ok(messages.Select(m => new { m.Role, m.Content, m.CreatedAt }));
        });

        // Delete a conversation
        chat.MapDelete("/sessions/{sessionId}", async (string sessionId, ConversationService svc) =>
        {
            await svc.DeleteSession(sessionId);
            return Results.Ok(new { success = true });
        });

        // Generate a new session ID
        chat.MapGet("/new-session", () =>
            Results.Ok(new { sessionId = Guid.NewGuid().ToString("N")[..12] }));
    }
}
