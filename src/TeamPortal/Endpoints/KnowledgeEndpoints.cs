using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class KnowledgeEndpoints
{
    public static void MapKnowledgeEndpoints(this WebApplication app)
    {
        app.MapGet("/api/knowledge/tree", (KnowledgeService svc) =>
        {
            var tree = svc.GetTree();
            return Results.Ok(tree);
        }).RequireAuthorization();

        app.MapGet("/api/knowledge/content", (string path, KnowledgeService svc) =>
        {
            if (string.IsNullOrWhiteSpace(path))
                return Results.Problem("Path parameter is required", statusCode: 400);

            var content = svc.GetContent(path);
            if (content is null)
                return Results.Problem("File not found", statusCode: 404);

            return Results.Ok(new { path, content });
        }).RequireAuthorization();
    }
}
