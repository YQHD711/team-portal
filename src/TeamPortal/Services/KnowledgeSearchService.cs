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
    /// 检索入口见 KnowledgeSearchService.Query.cs（task-21 起是"预处理 + 弱结果自动二次检索"）：
    /// <see cref="Search"/> 只返回结果，<see cref="SearchDetailed"/> 额外告诉调用方本次结果是否"弱"。
    /// </summary>

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
