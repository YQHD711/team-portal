using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class InventoryEndpoints
{
    public static void MapInventoryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/inventory").RequireAuthorization();

        group.MapGet("/", async (string? search, string? category, InventoryService svc) =>
        {
            var items = await svc.GetAll(search, category);
            return Results.Ok(items);
        });

        group.MapGet("/{id:int}", async (int id, InventoryService svc) =>
        {
            var item = await svc.GetById(id);
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapPost("/", async (CreateItemRequest req, InventoryService svc) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.Problem("Name is required", statusCode: 400);

            var item = await svc.Create(req.Name, req.Category ?? "", req.Quantity, req.Location ?? "", req.Status ?? "available");
            return Results.Created($"/api/inventory/{item.Id}", item);
        });

        group.MapPost("/import", async (ImportRequest req, InventoryService svc) =>
        {
            if (string.IsNullOrWhiteSpace(req.FilePath))
                return Results.Problem("FilePath is required", statusCode: 400);

            var count = await svc.ImportFromExcel(req.FilePath);
            return Results.Ok(new { imported = count });
        });

        group.MapPut("/{id:int}", async (int id, UpdateItemRequest req, InventoryService svc) =>
        {
            var item = await svc.Update(id, req.Quantity, req.Location, req.Status);
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapDelete("/{id:int}", async (int id, InventoryService svc) =>
        {
            var deleted = await svc.Delete(id);
            return deleted ? Results.Ok(new { deleted = true }) : Results.Problem("Not found", statusCode: 404);
        });
    }
}

public record CreateItemRequest(string Name, string? Category, int Quantity, string? Location, string? Status);
public record UpdateItemRequest(int? Quantity, string? Location, string? Status);
public record ImportRequest(string FilePath);
