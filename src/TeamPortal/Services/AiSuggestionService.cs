using System.Collections.Concurrent;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// AI 聊天空会话的「建议问题」：**从该用户有权访问的真实内容里出题**，取代前端写死的那 4 条
/// （线上知识库根本没有物料/库房文档，点了只能用通用知识编）。
///
/// 三类来源（都不许编）：
///   - <c>study</c>：用户有部门且该部门建了学习库 → `<部门>怎么学？`（P1-2 已保证可答）；
///   - <c>inventory</c>：真实房间（StorageLayout）→ `「1030 库房」的货架分布？`；真实物料 → `「X」还剩多少？`
///     （物料数 &lt; <see cref="MinItemsForItemQuestion"/> 时不出物料题，避免把占位数据当建议）；
///   - <c>doc</c>：有权访问的文档树 → 真实 `##/###` 小节 → `《X》里「Y」是怎么规定的？`
///     （ACL 与检索同一套：只走 KnowledgeService.GetTree）。
///
/// 约束：不调 AI、不花 token；每次最多打开 <see cref="MaxDocsOpened"/> 个文档且只读开头
/// <see cref="HeadChars"/> 字符；结果按 (role, dept, uid, 知识库路径) 缓存 <see cref="CacheTtl"/>；
/// 任何异常吞掉返回空表。出题策略与小节抽取见 AiSuggestionService.Questions.cs。
/// </summary>
public partial class AiSuggestionService
{
    public const int MaxSuggestions = 4;
    /// <summary>每次请求最多打开多少个文档（候选排序后取前 N 个）。</summary>
    public const int MaxDocsOpened = 12;
    public const int HeadChars = 8000;
    public static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);
    private const int MaxCacheEntries = 500;

    /// <summary>题面形状（序列化为 camelCase 的 text / kind）。</summary>
    public record Suggestion(string Text, string Kind);

    private sealed record CacheEntry(DateTime ExpiresAtUtc, List<Suggestion> Items);

    // 静态缓存：服务是 scoped，缓存必须跨请求；键里带知识库路径，避免不同库（含测试）互相串味。
    private static readonly ConcurrentDictionary<string, CacheEntry> Cache = new();
    /// <summary>实际读盘次数（测试用来断言缓存生效）。</summary>
    /// <summary>本实例实际读盘次数（测试用来断言缓存生效；按实例计数，测试之间互不干扰）。</summary>
    internal int FilesRead => _filesRead;

    private int _filesRead;

    private readonly KnowledgeService _knowledge;
    private readonly AppDbContext _db;
    private readonly ILogger<AiSuggestionService> _logger;

    public AiSuggestionService(KnowledgeService knowledge, AppDbContext db, ILogger<AiSuggestionService> logger)
    {
        _knowledge = knowledge;
        _db = db;
        _logger = logger;
    }

    /// <summary>取建议（带缓存）。任何异常都吞掉：这个接口挂了不能连累聊天页。</summary>
    public async Task<List<Suggestion>> BuildAsync(string? role, string? department, int userId, CancellationToken ct = default)
    {
        var key = $"{role}|{department}|{userId}|{_knowledge.BasePath}";
        if (Cache.TryGetValue(key, out var hit) && hit.ExpiresAtUtc > DateTime.UtcNow) return hit.Items;

        List<Suggestion> items;
        try
        {
            items = await BuildCoreAsync(role, department, userId, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "构建 AI 建议问题失败，本次返回空表");
            items = [];
        }

        if (Cache.Count > MaxCacheEntries) Cache.Clear();
        Cache[key] = new CacheEntry(DateTime.UtcNow.Add(CacheTtl), items);
        return items;
    }

    private async Task<List<Suggestion>> BuildCoreAsync(string? role, string? department, int userId, CancellationToken ct)
    {
        var tree = _knowledge.GetTree(role, department, userId);
        var result = new List<Suggestion>();

        // 学习库题优先：P1-2 已把学习库导进索引，「<部门>怎么学？」是真能答的
        if (StudySuggestion(tree, role, department) is { } study) result.Add(study);
        result.AddRange(await InventorySuggestionsAsync(ct));

        foreach (var doc in Files(tree)
                     .Where(f => !IsInStudyFolder(f.Path))
                     .OrderByDescending(Score)
                     .ThenBy(f => f.Path, StringComparer.Ordinal)
                     .Take(MaxDocsOpened))
        {
            if (result.Count >= MaxSuggestions) break;
            result.Add(DocSuggestion(doc));
        }
        return result;
    }

    private static Suggestion? StudySuggestion(List<TreeNode> tree, string? role, string? department)
    {
        if (string.IsNullOrWhiteSpace(department)) return null;   // 没有部门（如管理员）就不出这条
        var scopes = StudyLibraryService.Build(tree, role, department);
        return scopes.Any(s => s.Scope == department) ? new Suggestion($"{department}怎么学？", "study") : null;
    }

    private static bool IsInStudyFolder(string? path) =>
        path?.Replace('\\', '/').Split('/').Contains(StudyLibraryService.FolderName) == true;

    private Suggestion DocSuggestion(TreeNode file)
    {
        var title = DisplayTitle(file.Name);
        var heading = BestHeading(ReadHead(file.Path!));
        return heading is null
            ? new Suggestion($"《{title}》讲了什么？", "doc")
            : new Suggestion($"《{title}》里「{heading}」是怎么规定的？", "doc");
    }

    /// <summary>文档树里的叶子文件（GetTree 已按 ACL 过滤，这里不再判断可见性）。</summary>
    private static IEnumerable<TreeNode> Files(IEnumerable<TreeNode> nodes)
    {
        foreach (var node in nodes)
        {
            if (node.Type == "file" && !string.IsNullOrEmpty(node.Path)) yield return node;
            else if (node.Children is { Count: > 0 })
                foreach (var child in Files(node.Children)) yield return child;
        }
    }

    /// <summary>
    /// 该用户可见、且会参与出题的文档路径（= 已按 ACL 过滤的树里排除学习库）。
    /// 单独暴露给测试：出题只能来自这份集合，用来钉住"不给无权文档出题"。
    /// </summary>
    internal List<string> CandidateDocPaths(string? role, string? department, int userId) =>
        Files(_knowledge.GetTree(role, department, userId))
            .Where(f => !IsInStudyFolder(f.Path))
            .Select(f => f.Path!)
            .ToList();

    /// <summary>只读文件开头若干字符（找小节用，不需要整篇）。</summary>
    private string ReadHead(string relativePath)
    {
        var full = _knowledge.AbsolutePath(relativePath);
        if (full is null || !File.Exists(full)) return "";
        try
        {
            using var reader = new StreamReader(full);
            var buffer = new char[HeadChars];
            var read = reader.ReadBlock(buffer, 0, HeadChars);
            _filesRead++;
            return new string(buffer, 0, read);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "读取知识库文档失败（跳过该文档）：{Path}", relativePath);
            return "";
        }
    }
}
