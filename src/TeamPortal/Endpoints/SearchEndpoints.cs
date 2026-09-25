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
            var staff = role is "admin" or "部长";

            // Knowledge base — 索引覆盖全部部门目录,必须带上调用者身份做范围过滤
            // （过滤在 KnowledgeSearchService 计分前完成，见那里的注释）
            // 知识库是管理端内容：队员只应搜到**学习库**（公共/本部门），其余一律不返回；
            // 因此队员多取一些再筛，免得筛完只剩一两条。
            var kbResults = ks.Search(keyword, staff ? 5 : 20, role, dept, uid)
                .Where(r => ShouldIncludeKnowledgeResult(r.Path, staff))
                .Take(5)
                .Select(r => new
                {
                    type = IsStudyDoc(r.Path) ? "study" : "knowledge",
                    title = System.IO.Path.GetFileName(r.Path),
                    snippet = r.Snippet,
                    path = KnowledgeTarget(r.Path, keyword)
                });

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

    /// <summary>
    /// 是不是学习库内容：路径里出现「学习库」目录段即算（与 StudyLibraryService 的目录约定一致）。
    /// </summary>
    internal static bool IsStudyDoc(string path) =>
        path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries).Contains("学习库");

    /// <summary>
    /// 学习库里的「说明类」文档（`_学习路径.md` / `_阶段说明.md`）：它们不是课时，
    /// 正文由学习库总览页直接展示，所以跳总览页而不是 `?lesson=`。
    /// </summary>
    internal static bool IsStudyOverviewDoc(string path) =>
        Path.GetFileName(path.Replace('\\', '/')).StartsWith('_');

    /// <summary>
    /// 这条知识库结果该不该给这位用户看。
    ///
    /// 知识库本体是管理端内容（编辑器在 /admin 下，非 staff 会被 AuthGuard 踢回首页），
    /// 所以队员的搜索结果里**不出现**知识库文档，只保留学习库（公共 + 本部门，ACL 已在
    /// KnowledgeSearchService 里过滤过）。
    /// </summary>
    internal static bool ShouldIncludeKnowledgeResult(string path, bool staff) =>
        staff || IsStudyDoc(path);

    /// <summary>
    /// 搜索结果该跳到哪。
    /// - 学习库课时 → `/study?lesson=`；说明类 → 学习库总览页
    /// - 其它文档 → 管理端编辑器（只会是 staff：队员的非学习库结果已被过滤掉）
    ///
    /// 以前一律指向 /admin/knowledge，队员点一下就被 AuthGuard 弹回首页 ——
    /// 现在队员根本不会拿到这类结果。
    /// </summary>
    internal static string KnowledgeTarget(string path, string? keyword = null)
    {
        var encoded = Uri.EscapeDataString(path);
        if (!IsStudyDoc(path))
            return $"/admin/knowledge?path={encoded}&q={Uri.EscapeDataString(keyword ?? "")}";
        return IsStudyOverviewDoc(path) ? "/study" : $"/study?lesson={encoded}";
    }
}
