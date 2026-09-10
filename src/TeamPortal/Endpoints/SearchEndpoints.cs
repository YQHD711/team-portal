using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class SearchEndpoints
{
    public static void MapSearchEndpoints(this WebApplication app)
    {
        app.MapGet("/api/search", async (string q, ClaimsPrincipal user, AppDbContext db, KnowledgeSearchService ks, KnowledgeService knowledge) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
                return Results.Ok(new { knowledge = Array.Empty<object>(), inventory = Array.Empty<object>(), wiki = Array.Empty<object>(), files = Array.Empty<object>() });

            var keyword = q.ToLower().Trim();
            var role = user.FindFirstValue(ClaimTypes.Role);
            var dept = user.FindFirstValue("Department");
            var uid = int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

            // Knowledge base — 索引覆盖全部部门目录,必须带上调用者身份做范围过滤
            var kbResults = ks.Search(keyword, 5, role, dept, uid).Select(r => new { type = "knowledge", title = System.IO.Path.GetFileName(r.Path), snippet = r.Snippet, path = $"/admin/knowledge?path={Uri.EscapeDataString(r.Path)}&q={Uri.EscapeDataString(keyword)}" });

            // Inventory
            var items = await db.InventoryItems
                .Where(i => i.Name.ToLower().Contains(keyword) || (i.Category != null && i.Category.ToLower().Contains(keyword)))
                .Take(5).Select(i => new { type = "inventory", title = i.Name, snippet = $"库存: {i.Quantity} · {i.Category} · {i.LocationCode ?? ""}", path = $"/inventory?id={i.Id}" })
                .ToListAsync();

            // Wiki tasks — 与 /api/wiki 列表同一套可见性规则(旧实现忽略 Visibility,会搜出他人私人项目)
            var wikis = await db.WikiTasks
                .Where(w => w.Status == "completed" && w.ProjectName.ToLower().Contains(keyword))
                .Where(w => w.Visibility == "public" ||
                            (w.Visibility == "department" && (role == "admin" || dept == w.TargetFolder)) ||
                            (w.Visibility == "personal" && (role == "admin" || w.UserId == uid)))
                .Take(5).Select(w => new { type = "wiki", title = w.ProjectName, snippet = $"类型: {w.Type} · {w.Visibility}", path = $"/wiki/{w.Id}" })
                .ToListAsync();

            // Shared files — 部门可见文件对其它部门不可见(与 /api/files 列表一致)
            var files = await db.SharedFiles
                .Where(f => f.OriginalName.ToLower().Contains(keyword))
                .Where(f => f.Visibility == "public" || (f.Visibility == "department" && (role == "admin" || f.Department == dept)))
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
