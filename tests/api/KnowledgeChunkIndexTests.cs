using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P1-1 分块索引与 BM25：
///   - 分块窗口 800/重叠 100；
///   - 同一文档多分块**取 max**（不是求和）；
///   - snippet 取自**命中分块**（长文档答案在后半段时不再截到文档开头）；
///   - _docCount 语义已变为分块数（IDF 的 N），文档数另算；
///   - BM25 的 IDF/TF 项性质。
/// </summary>
public class KnowledgeChunkIndexTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly IConfigurationRoot _config;

    public KnowledgeChunkIndexTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-chunk-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
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

    private KnowledgeSearchService Create() => new(_config, NullLogger<KnowledgeSearchService>.Instance,
        new TestScopeFactory(_db), new NullLogService(new TestScopeFactory(_db)));

    private void Write(string name, string content) =>
        File.WriteAllText(Path.Combine(_kbDir, "公共", name), content);

    // ── 分块窗口 ──

    [Fact]
    public void ChunkRanges_EmptyAndExactWindow()
    {
        Assert.Empty(KnowledgeSearchService.ChunkRanges(0).ToList());
        Assert.Equal([(0, 800)], KnowledgeSearchService.ChunkRanges(800).ToList());
        Assert.Equal([(0, 800), (700, 800), (1400, 200)], KnowledgeSearchService.ChunkRanges(1600).ToList());
    }

    [Fact]
    public void ChunkRanges_Step700_Overlap100_AndNeverPastEnd()
    {
        var ranges = KnowledgeSearchService.ChunkRanges(5000).ToList();

        Assert.All(ranges, r => Assert.True(r.Length <= KnowledgeSearchService.ChunkSize));
        for (var i = 1; i < ranges.Count; i++)
            Assert.Equal(KnowledgeSearchService.ChunkSize - KnowledgeSearchService.ChunkOverlap,
                ranges[i].Start - ranges[i - 1].Start);
        Assert.Equal(5000, ranges[^1].Start + ranges[^1].Length);
    }

    // ── 索引语义：分块数 vs 文档数 ──

    [Fact]
    public void IndexedChunkCount_CountsChunks_NotDocuments()
    {
        Write("long.md", new string('甲', 1900));

        using var search = Create();

        Assert.Equal(1, search.IndexedDocumentCount);
        Assert.Equal(3, search.IndexedChunkCount);   // 1900 → (0,800)(700,800)(1400,500)
        Assert.True(search.IndexedPostingCount > 0);
    }

    // ── snippet 取命中分块 ──

    [Fact]
    public void LongDocument_SnippetComesFromHitChunk_NotDocumentStart()
    {
        // 开头（目录）提 1 次、后半段答案段落密集出现 3 次 → BM25 命中后半段那一块。
        // 若 snippet 仍按"整篇文档 + 首次出现"截（P1-1 之前的行为），摘要会从开头的目录处开始，
        // 于是把「目录」带出来 —— 这正是长文档摘要"答非所问"的形态。
        const string term = "量子纠缠推进器";
        var head = "目录：提到" + term + "。" + new string('甲', 700);
        var middle = new string('乙', 900);
        var answer = "答案段落：" + term + "，" + term + "，另见" + term + " 的详细说明。";
        Write("long.md", head + middle + answer);

        using var search = Create();
        var hits = search.Search(term, 5, "admin", null);

        var hit = Assert.Single(hits);
        Assert.Contains(term, hit.Snippet);
        Assert.DoesNotContain("目录", hit.Snippet);                     // snippet 必须落在命中的答案块里
        Assert.Contains("答案段落", hit.Snippet);
        Assert.True(hit.Snippet.Length < KnowledgeSearchService.ChunkSize + 400, "snippet 应限定在命中分块内");
    }

    [Fact]
    public void SameDocumentMultipleChunkHits_TakeMaxNotSum()
    {
        const string term = "量子纠缠推进器";
        var chunkA = new string('甲', 700);
        var chunkB = new string('乙', 700);
        var chunkC = new string('丙', 700);
        Write("a.md", chunkA + chunkB + chunkC + term);               // 只有最后一个分块命中
        Write("b.md", term + chunkA + term + chunkB + term + chunkC); // 三个分块都命中

        using var search = Create();
        var hits = search.Search(term, 5, "admin", null);

        var a = hits.Single(h => h.Path == "公共/a.md");
        var b = hits.Single(h => h.Path == "公共/b.md");
        // 取 max：两份文档的最高分应该差不多；若误用求和，b 会是 a 的约 3 倍
        Assert.True(b.Score < a.Score * 1.5, $"多分块应按 max 聚合：a={a.Score:F3}, b={b.Score:F3}");
    }

    // ── 分词口径（记录取舍） ──

    [Fact]
    public void CjkBigramQueryMatches_ButSingleCharQueryDoesNot()
    {
        Write("c.md", "飞行安全手册：起降检查单与失速改出。");

        using var search = Create();

        Assert.NotEmpty(search.Search("飞行", 5, "admin", null));   // bigram 命中
        Assert.Empty(search.Search("飞", 5, "admin", null));        // 索引侧不再放单字（内存取舍，见 Index 注释）
    }

    // ── BM25 ──

    [Fact]
    public void Bm25Idf_RarerTermScoresHigher()
    {
        var rare = KnowledgeSearchService.Bm25Idf(1000, 2);
        var common = KnowledgeSearchService.Bm25Idf(1000, 500);

        Assert.True(rare > common);
        Assert.True(common > 0);
    }

    [Fact]
    public void Bm25Tf_SaturatesWithFrequency_AndPenalizesLongChunks()
    {
        // tf=1 且长度=平均长度时，k1 归一后正好是 1.0
        Assert.Equal(1.0, KnowledgeSearchService.Bm25Tf(1, 100, 100), 6);
        Assert.True(KnowledgeSearchService.Bm25Tf(3, 100, 100) > KnowledgeSearchService.Bm25Tf(1, 100, 100));
        Assert.True(KnowledgeSearchService.Bm25Tf(10, 100, 100) < 3 * KnowledgeSearchService.Bm25Tf(3, 100, 100)); // 饱和
        Assert.True(KnowledgeSearchService.Bm25Tf(1, 800, 100) < KnowledgeSearchService.Bm25Tf(1, 100, 100));     // 长块降权
    }
}
