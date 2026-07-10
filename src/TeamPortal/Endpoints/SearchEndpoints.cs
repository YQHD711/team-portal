using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class SearchEndpoints
{
    public static void MapSearchEndpoints(this WebApplication app)
    {
        app.MapGet("/api/search", async (string q, AppDbContext db, KnowledgeSearchService ks, KnowledgeService knowledge) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
                return Results.Ok(new { knowledge = Array.Empty<object>(), inventory = Array.Empty<object>(), wiki = Array.Empty<object>(), files = Array.Empty<object>() });

            var keyword = q.ToLower().Trim();

            // Knowledge base
            var kbResults = ks.Search(keyword).Take(5).Select(r => new { type = "knowledge", title = System.IO.Path.GetFileName(r.Path), snippet = r.Snippet, path = r.Path });

            // Inventory
            var items = await db.InventoryItems
                .Where(i => i.Name.ToLower().Contains(keyword) || (i.Category != null && i.Category.ToLower().Contains(keyword)))
                .Take(5).Select(i => new { type = "inventory", title = i.Name, snippet = $"库存: {i.Quantity} · {i.Category} · {i.LocationCode ?? ""}", path = $"/inventory?id={i.Id}" })
                .ToListAsync();

            // Wiki tasks
            var wikis = await db.WikiTasks
                .Where(w => w.Status == "completed" && w.ProjectName.ToLower().Contains(keyword))
                .Take(5).Select(w => new { type = "wiki", title = w.ProjectName, snippet = $"类型: {w.Type} · {w.Visibility}", path = $"/wiki/{w.Id}" })
                .ToListAsync();

            // Shared files
            var files = await db.SharedFiles
                .Where(f => f.OriginalName.ToLower().Contains(keyword))
                .Take(5).Select(f => new { type = "file", title = f.OriginalName, snippet = $"{f.Size} bytes · {f.UploaderName}", path = $"/files?id={f.Id}" })
                .ToListAsync();

            return Results.Ok(new
            {
                knowledge = kbResults,
                inventory = items,
                wiki = wikis,
                files = files
            });
        }).RequireAuthorization();
    }
}
