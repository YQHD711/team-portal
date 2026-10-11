using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// TF-IDF/BM25 full-text search over knowledge base with inverted index.
/// Auto-rebuilds on file changes via FileSystemWatcher.
/// P1-1：索引改为**分块**索引、打分改为 **BM25(k1=1.5, b=0.75)**，同文档多分块取 max，snippet 取命中分块。
/// 索引结构/分词/分块见 KnowledgeSearchService.Index.cs，摘要提取见 KnowledgeSearchService.Snippets.cs。
/// </summary>
public partial class KnowledgeSearchService : IDisposable
{
    private readonly string _basePath;
    private readonly IConfiguration _config;
    private readonly ILogger<KnowledgeSearchService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly LogService _log;
    private readonly FileSystemWatcher? _watcher;
    private readonly object _lock = new();

    public KnowledgeSearchService(IConfiguration config, ILogger<KnowledgeSearchService> logger,
        IServiceScopeFactory scopeFactory, LogService log)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _log = log;
        _config = config;
        _basePath = config.GetValue<string>("Knowledge:BasePath")
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "knowledge");

        if (Directory.Exists(_basePath))
        {
            RebuildIndex();

            // Watch for file changes
            try
            {
                _watcher = new FileSystemWatcher(_basePath)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                    EnableRaisingEvents = true
                };
                _watcher.Created += (_, _) => DebounceRebuild();
                _watcher.Changed += (_, _) => DebounceRebuild();
                _watcher.Deleted += (_, _) => DebounceRebuild();
                _watcher.Renamed += (_, _) => DebounceRebuild();
            }
            catch { _logger.LogWarning("FileSystemWatcher could not be initialized for knowledge base"); }
        }

        _logger.LogInformation("KnowledgeSearchService initialized with {Count} chunks", _snapshot.ChunkCount);
    }

    private CancellationTokenSource? _debounceCts;
    private void DebounceRebuild()
    {
        _debounceCts?.Cancel();
        _debounceCts = new CancellationTokenSource();
        Task.Delay(3000, _debounceCts.Token).ContinueWith(t =>
        {
            if (!t.IsCanceled) RebuildIndex();
        }, TaskContinuationOptions.NotOnCanceled);
    }

    /// <summary>
    /// BM25 检索。索引覆盖全部部门目录,因此**必须在计分前按调用者角色/部门过滤**
    /// (放到 Take(topK) 之后再过滤会让有权文档被无权文档挤掉,同时也没堵住泄露)。
    ///
    /// 打分：每个**分块**先累加各 query token 的 BM25 分；同一文档的多个分块只保留最高分那块，
    /// snippet 也从那块取（长文档答案在后半段时不会退化成文档开头）。
    /// </summary>
    public List<KbResult> Search(string query, int topK, string? role, string? department, int userId = 0)
    {
        var snap = _snapshot;   // 一次取快照：重建期间也不会读到半新半旧的索引
        if (snap.ChunkCount == 0)
        {
            LogSearch(query, hits: 0, returned: 0);
            return new List<KbResult>();
        }

        var queryTokens = TokenizeQuery(query);
        if (queryTokens.Length == 0)
        {
            LogSearch(query, hits: 0, returned: 0);
            return new List<KbResult>();
        }

        var invisibleProjects = InvisibleProjectNames(role, department, userId);
        bool Allowed(string path) =>
            KnowledgeAcl.CanAccess(path, role, department) &&
            !KnowledgeAcl.IsInvisibleWikiProject(path, invisibleProjects);

        var chunkScores = new Dictionary<int, double>();
        foreach (var token in queryTokens)
        {
            if (!snap.Index.TryGetValue(Hash(token), out var packed)) continue;
            var (offset, count) = Unpack(packed);
            var idf = Bm25Idf(snap.ChunkCount, count);
            for (var i = 0; i < count; i++)
            {
                var at = offset + i;
                var chunkId = snap.PostingChunks[at];
                var chunk = snap.Chunks[chunkId];
                if (!Allowed(chunk.Path)) continue;
                var score = idf * Bm25Tf(snap.PostingTfs[at], chunk.TokenCount, snap.AvgChunkLength);
                chunkScores.TryGetValue(chunkId, out var existing);
                chunkScores[chunkId] = existing + score;
            }
        }

        // 同一文档多分块取 max（规格要求）；命中分块同时用于取 snippet
        var best = new Dictionary<string, (double Score, int Chunk)>(StringComparer.Ordinal);
        foreach (var (chunkId, score) in chunkScores)
        {
            var path = snap.Chunks[chunkId].Path;
            if (!best.TryGetValue(path, out var current) || score > current.Score)
                best[path] = (score, chunkId);
        }

        var results = new List<KbResult>();
        foreach (var (path, hit) in best.OrderByDescending(x => x.Value.Score).Take(topK))
        {
            results.Add(new KbResult
            {
                Path = path,
                Snippet = SnippetForChunk(snap, hit.Chunk, query, queryTokens),
                Score = hit.Score,
            });
        }

        LogSearch(query, chunkScores.Count, results.Count);
        return results;
    }

    /// <summary>
    /// RAG 可观测性：每次检索留一行统计（Category=ai）。空转判据是**返回条数为 0**
    /// （即没有任何可注入的文档）；hits 是命中的**分块数**（分块索引下 scores 字典按分块计）。
    /// 真正注入了几篇由 AiProxyService 的 "RAG context: used=" 记录。
    /// </summary>
    private void LogSearch(string query, int hits, int returned) =>
        _log.Info(RagLog.Category, RagLog.SearchLine(query, hits, returned, returned == 0));

    /// <summary>
    /// 按 wiki 任务的 Visibility 计算对调用者不可见的项目名(与知识库树的规则一致):
    /// 他部门的 department 可见项目 + 他人的 personal 项目。
    /// </summary>
    private HashSet<string> InvisibleProjectNames(string? role, string? department, int userId)
    {
        if (role == "admin") return new HashSet<string>(StringComparer.Ordinal);
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var deptProjects = db.WikiTasks
                .Where(t => t.Visibility == "department" && t.TargetFolder != department)
                .Select(t => t.ProjectName);
            var personalProjects = db.WikiTasks
                .Where(t => t.Visibility == "personal" && t.UserId != userId)
                .Select(t => t.ProjectName);
            return deptProjects.AsEnumerable().Union(personalProjects.AsEnumerable()).ToHashSet(StringComparer.Ordinal);
        }
        catch (Exception ex)
        {
            // 查不到可见性时:路径级 ACL 仍生效(跨部门仍被挡住),这里只记告警不做额外过滤,
            // 避免整库搜索因一次 DB 抖动而不可用。
            _logger.LogWarning(ex, "计算 wiki 项目可见性失败,本次搜索仅应用路径级 ACL");
            return new HashSet<string>(StringComparer.Ordinal);
        }
    }

    public void Dispose()
    {
        _watcher?.Dispose();
        _debounceCts?.Cancel();
    }
}

public class KbResult
{
    public string Path { get; set; } = "";
    public string Snippet { get; set; } = "";
    public double Score { get; set; }
}
