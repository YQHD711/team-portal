using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class AiEndpoints
{
    public static void MapAiEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/ai").RequireAuthorization();

        group.MapPost("/chat", async (ChatRequest req, AiProxyService proxy) =>
        {
            var stream = await proxy.ChatStream(req.Question);
            if (stream is null)
                return Results.Problem("AI service unavailable", statusCode: 503);

            return Results.Stream(stream, "text/event-stream");
        });

        group.MapPost("/search", async (SearchRequest req, AiProxyService proxy) =>
        {
            var result = await proxy.Search(req.Query);
            if (result is null)
                return Results.Problem("Search service unavailable", statusCode: 503);

            return Results.Ok(result);
        });
    }
}

public record ChatRequest(string Question);
public record SearchRequest(string Query);
