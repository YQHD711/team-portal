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

            // 可见的已完成 wiki 项目（与 /api/wiki 列表、CanViewTask 同一套 Visibility 规则）。
            // 一次取回后派两个用场：① 按项目名匹配；② 把 wiki **正文**的搜索结果落回 wiki 阅读页 ——
            // wiki 文档就存在知识库目录下（{TargetFolder}/{ProjectName}/...），不映射的话
            // 搜到正文只能给个 /admin/knowledge，等于把 wiki 内容排除在搜索之外。
            var visibleWikiTasks = await db.WikiTasks
                .Where(w => w.Status == "completed")
                .Where(w => w.Visibility == "public" ||
                            (w.Visibility == "department" && (role == "admin" || dept == w.TargetFolder)) ||
                            (w.Visibility == "personal" && (role == "admin" || w.UserId == uid)))
                .Select(w => new { w.Id, w.ProjectName, w.TargetFolder, w.Type, w.Visibility })
                .Take(500)
                .ToListAsync();

            // 长前缀优先：项目名互为前缀时（如 "docs" 与 "docs-advanced"）要落到更精确的那个
            var wikiPrefixes = visibleWikiTasks
                .Select(w => (Prefix: $"{w.TargetFolder.Trim('/')}/{w.ProjectName}/", w.Id))
                .OrderByDescending(p => p.Prefix.Length)
                .ToList();

            (string Prefix, string Id)? WikiOwner(string path)
            {
                var normalized = path.Replace('\\', '/');
                foreach (var candidate in wikiPrefixes)
                    if (normalized.StartsWith(candidate.Prefix, StringComparison.Ordinal)) return candidate;
                return null;
            }

            // Knowledge base — 索引覆盖全部部门目录,必须带上调用者身份做范围过滤
            // （过滤在 KnowledgeSearchService 计分前完成，见那里的注释）
            // 队员不返回知识库文档，只保留学习库与「对他可见的 wiki 正文」；
            // 因此队员多取一些候选再筛，免得筛完只剩一两条。
            var kbResults = ks.Search(keyword, staff ? 5 : 20, role, dept, uid)
                .Select(r => new { Hit = r, Wiki = WikiOwner(r.Path) })
                .Where(x => ShouldIncludeKnowledgeResult(x.Hit.Path, staff, x.Wiki is not null))
                .Take(5)
                .Select(x => new
                {
                    type = x.Wiki is not null ? "wiki" : IsStudyDoc(x.Hit.Path) ? "study" : "knowledge",
                    title = System.IO.Path.GetFileName(x.Hit.Path),
                    snippet = x.Hit.Snippet,
                    path = x.Wiki is not null
                        ? WikiDocTarget(x.Wiki.Value.Id, WikiDocPath(x.Hit.Path, x.Wiki.Value.Prefix))
                        : KnowledgeTarget(x.Hit.Path, keyword)
                })
                .ToList();

            // Inventory
            var items = await db.InventoryItems
                .Where(i => i.Name.ToLower().Contains(keyword) || (i.Category != null && i.Category.ToLower().Contains(keyword)))
                .Take(5).Select(i => new { type = "inventory", title = i.Name, snippet = $"库存: {i.Quantity} · {i.Category} · {i.LocationCode ?? ""}", path = $"/inventory?id={i.Id}" })
                .ToListAsync();

            // Wiki tasks — 按项目名匹配（可见性已在上面的 visibleWikiTasks 里过滤）
            var wikis = visibleWikiTasks
                .Where(w => w.ProjectName.ToLower().Contains(keyword))
                .Take(5)
                .Select(w => new { type = "wiki", title = w.ProjectName, snippet = $"类型: {w.Type} · {w.Visibility}", path = $"/wiki/{w.Id}" })
                .ToList();

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
    /// 所以队员的搜索结果里**不出现**知识库文档；学习库和「对他可见的 wiki 正文」例外 ——
    /// 前者本来就是给队员看的，后者有独立的 Visibility 规则且能在 /wiki 页读。
    /// </summary>
    internal static bool ShouldIncludeKnowledgeResult(string path, bool staff, bool visibleWikiDoc = false) =>
        staff || IsStudyDoc(path) || visibleWikiDoc;

    /// <summary>
    /// 知识库路径 → wiki 阅读页的 ?doc= 参数。
    /// 约定见 /api/wiki/tasks/{id}/doc：kbPath = {TargetFolder}/{ProjectName}/{docPath}.md，
    /// 因此去掉项目前缀与 .md 后缀就是 docPath。
    /// </summary>
    internal static string WikiDocPath(string kbPath, string projectPrefix)
    {
        var normalized = kbPath.Replace('\\', '/');
        var rel = normalized.StartsWith(projectPrefix, StringComparison.Ordinal)
            ? normalized[projectPrefix.Length..]
            : normalized;
        return rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? rel[..^3] : rel;
    }

    /// <summary>wiki 正文结果 → `/wiki/{任务}?doc={项目内路径}`（前端会直接打开这一篇）。</summary>
    internal static string WikiDocTarget(string taskId, string docPath) =>
        $"/wiki/{taskId}?doc={Uri.EscapeDataString(docPath)}";

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
