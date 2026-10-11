using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P0-1 检索侧闭环：中文 query 命中英文原文（sidecar 只贡献索引内容，返回的是原文 + 原文 snippet），
/// 且 sidecar 不出现在知识库树、不可被读取（规格 checklist 第 3 条）。
/// </summary>
public class KnowledgeBridgeSearchTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly IConfigurationRoot _config;

    public KnowledgeBridgeSearchTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-bridge-kb-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));
        File.WriteAllText(Path.Combine(_kbDir, "公共", "plane.md"),
            "TECS circle radius is determined by bank angle and groundspeed. " +
            new string('x', 200) + "\nThe navigation controller limits bank angle to protect the airframe.");
        File.WriteAllText(Path.Combine(_kbDir, "公共", "plane.md.zhidx.json"),
            KnowledgeBridge.BuildJson("公共/plane.md", "导航TECS：盘旋半径",
                ["盘旋半径", "TECS", "滚转角", "地速", "导航"], "说明盘旋半径由滚转角与地速决定"));
        File.WriteAllText(Path.Combine(_kbDir, "公共", "中文.md"), "盘旋半径由滚转角和地速决定，这是中文文档。");

        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        _db.Database.EnsureCreated();
        _config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
    }

    public void Dispose()
    {
        try { Directory.Delete(_kbDir, true); } catch { /* best-effort */ }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void ChineseQuery_HitsEnglishDoc_AndSnippetComesFromTheOriginal()
    {
        var search = new KnowledgeSearchService(_config, NullLogger<KnowledgeSearchService>.Instance, new TestScopeFactory(_db), new NullLogService(new TestScopeFactory(_db)));

        var results = search.Search("盘旋半径由什么决定", 5, "admin", null);

        var hit = results.FirstOrDefault(r => r.Path == "公共/plane.md");
        Assert.NotNull(hit);                                   // 中文 query 命中了英文原文
        Assert.Contains("TECS", hit!.Snippet);                 // snippet 出自英文原文，不是 sidecar 的 JSON
        Assert.DoesNotContain("zhidx", hit.Snippet);
        Assert.DoesNotContain(results, r => r.Path.EndsWith(".zhidx.json"));  // sidecar 不单独成为文档
    }

    [Fact]
    public void Sidecar_DoesNotAppearInTree_AndCannotBeReadOrDownloaded()
    {
        var log = new NullLogService(new TestScopeFactory(_db));
        var knowledge = new KnowledgeService(_config, log, new TestScopeFactory(_db));
        const string sidecar = "公共/plane.md.zhidx.json";

        Assert.Null(knowledge.GetContent(sidecar));
        Assert.Null(knowledge.GetBinaryContent(sidecar));
        Assert.False(knowledge.FileExists(sidecar));
        Assert.True(KnowledgeService.IsInternalFile(sidecar));

        var paths = FlattenPaths(knowledge.GetTree("admin", null, 0));
        Assert.DoesNotContain(paths, p => p.EndsWith(".zhidx.json"));
        Assert.Contains("公共/plane.md", paths);               // 原文照常显示
    }

    private static List<string> FlattenPaths(List<TreeNode> nodes)
    {
        var result = new List<string>();
        foreach (var node in nodes)
        {
            if (node.Path is not null) result.Add(node.Path);
            if (node.Children is { Count: > 0 }) result.AddRange(FlattenPaths(node.Children));
        }
        return result;
    }
}
