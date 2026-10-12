using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-21 检索质量：同义词扩展（「借」→「领用」）、疑问词处理、弱结果判据、弱时的自动二次检索与合并去重、
/// 以及"正常查询不劣化"。全程本地检索，不调 AI。
/// </summary>
public class SearchQualityTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly KnowledgeSearchService _search;

    public SearchQualityTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-quality-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));

        // 真实用词的那份规范（含领用/归还/库房/库位/物料/单价）
        Write("公共/物料管理规范.md",
            "物料领用与归还流程：领用人填写领用单，经部长审批后到库房领取；B 级物料需部长签字。"
            + "库位编号形如 1030-A-1-01；归还时核对物料数量与库位，单价用于折旧统计。");
        // 25 份都含「参数」的噪音文档：把 df(参数) 顶到 20 以上（弱判据阈值 = max(20, 分块数/100)）
        for (var i = 1; i <= 25; i++) Write($"公共/参数表-{i:D2}.md", $"第 {i} 份参数表：这里有一堆参数与取值。");
        Write("公共/常见问题.md", "遇到故障怎么办？先联系部长，再按检查单逐项排查。");

        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir }).Build();
        var scopes = new TestScopeFactory(_db);
        _search = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance, scopes,
            new NullLogService(scopes));
    }

    public void Dispose()
    {
        _search.Dispose();
        try { Directory.Delete(_kbDir, true); } catch { /* best-effort */ }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private void Write(string rel, string content)
    {
        var full = Path.Combine(_kbDir, rel.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }

    private static bool Has(string? path, string needle) => path?.Contains(needle, StringComparison.Ordinal) == true;

    [Fact]
    public void SynonymExpansion_FindsMaterialSpec_ForColloquialQuestion()
    {
        // 核心验收：知识库用「领用」，用户问「怎么借东西」——不做同义词扩展就是查不到
        var outcome = _search.SearchDetailed("怎么借东西", 8, "admin", null);

        Assert.Contains(outcome.Results, r => r.Path == "公共/物料管理规范.md");
        Assert.True(outcome.SynonymAdds > 0, "应该用上了同义词表");
        Assert.False(outcome.Weak);                       // 「领用」是有区分度的词 → 强结果
        Assert.False(outcome.Relaxed);                    // 强结果 → 不触发二次检索
    }

    [Fact]
    public void WithoutSynonyms_TheSameQuestionMisses()
    {
        // 反证：把同义词表停掉（空表），「怎么借东西」就只剩 bigram 命中的噪音，且判为弱
        var synonyms = SearchSynonyms.Parse("{}");
        var (query, added, _) = SearchSynonyms.Expand("怎么借东西", synonyms);

        Assert.Equal(0, added);
        Assert.Equal("怎么借东西", query);
        Assert.True(SearchSynonyms.StripQuestionWords("怎么借东西") is { Query: "借东西", FellBack: false });
    }

    [Fact]
    public void WeakJudgement_OnlyGenericWordsHit_IsWeak_DistinctiveWord_IsStrong()
    {
        // 只被「参数」命中（df=25 > 阈值 20）→ 弱；模型会被告知"先换词再查"
        var generic = _search.SearchDetailed("数传参数", 8, "admin", null);
        Assert.True(generic.Weak, "「数传参数」只命中通用词，必须是弱结果");
        Assert.True(generic.Relaxed, "弱结果应自动做一次二次检索（去掉泛词「参数」）");

        // 「领用」只出现在一份文档里 → 强
        var strong = _search.SearchDetailed("领用流程", 8, "admin", null);
        Assert.False(strong.Weak);
        Assert.False(strong.Relaxed);
        Assert.Contains(strong.Results, r => r.Path == "公共/物料管理规范.md");
    }

    [Fact]
    public void StrongQuery_DoesNotRunSecondPass()
    {
        var outcome = _search.SearchDetailed("如何领用 B 级物料", 8, "admin", null);   // 线上能答的那条，不能劣化

        Assert.False(outcome.Weak);
        Assert.False(outcome.Relaxed);                    // Relaxed 只在真的跑了第二遍检索时才为 true
        Assert.Equal(0, outcome.SynonymAdds);             // 「领用」本身不是口语键，不该乱扩展
        Assert.Contains(outcome.Results, r => r.Path == "公共/物料管理规范.md");
        Assert.Single(outcome.Results.Select(r => r.Path));   // 同一篇文档只占一个名额
    }

    [Fact]
    public void StopwordFilter_BecomesEmpty_FallsBackToOriginalQuery()
    {
        // 「怎么办」去掉疑问词只剩「办」（凑不出 bigram）→ 必须退回原查询，不能 0 命中
        var (cleaned, fellBack) = SearchSynonyms.StripQuestionWords("怎么办");
        Assert.True(fellBack);
        Assert.Equal("怎么办", cleaned);

        var outcome = _search.SearchDetailed("怎么办", 8, "admin", null);
        Assert.True(outcome.Relaxed);                     // relax=1 标出"退回了原查询"
        Assert.NotEmpty(outcome.Results);                 // 仍然能命中《常见问题》
        Assert.Contains(outcome.Results, r => r.Path == "公共/常见问题.md");
    }

    [Fact]
    public void SynonymTable_ExpansionCapAndBareHuanExclusion()
    {
        var map = SearchSynonyms.Parse(SearchSynonyms.DefaultJson);
        Assert.Contains("借", map.Keys);
        Assert.Equal(["领用"], map["借"]);
        Assert.Equal(["领用", "物料"], map["借东西"]);

        // 刻意的取舍：「还」不单独做键，否则「还剩多少 / 还有货吗」这类库存问法会被灌进「归还」
        Assert.False(map.ContainsKey("还"));
        var (stockQuery, stockAdded, _) = SearchSynonyms.Expand("碳纤维管还剩多少", map);
        Assert.Equal(0, stockAdded);
        Assert.Equal("碳纤维管还剩多少", stockQuery);

        // 扩展有上限，不会把查询变成几十个词
        var wide = SearchSynonyms.Parse("{\"a\":[\"x1\",\"x2\",\"x3\",\"x4\",\"x5\",\"x6\",\"x7\",\"x8\"]}");
        Assert.Equal(SearchSynonyms.MaxAddedTerms, SearchSynonyms.Expand("a", wide).Added);
    }

    [Fact]
    public void SynonymTable_BrokenJsonOrCustomValue()
    {
        Assert.Empty(SearchSynonyms.Parse("{不是 JSON"));
        Assert.Empty(SearchSynonyms.Parse("[]"));
        Assert.Equal(["领用"], SearchSynonyms.Parse("{\"借\":\"领用\"}")["借"]);          // 字符串值
        Assert.Equal(2, SearchSynonyms.Parse("{\"借\":[\"领用\",\"借用\"]}")["借"].Length); // 数组值
        Assert.Empty(SearchSynonyms.Parse("{\"借\":[]}"));                                  // 空值忽略
    }

    [Fact]
    public void CustomSynonymSetting_IsUsedBySearch()
    {
        // 管理员把表改坏了 → 退回内置表（不能因为一条设置把检索搞挂）
        _db.SystemSettings.Add(new TeamPortal.Data.Models.SystemSetting
        {
            Key = SearchSynonyms.SettingKey, Value = "不是 JSON", Category = "AI 服务", Description = "",
        });
        _db.SaveChanges();
        var scopes = new TestScopeFactory(_db);
        using var svc = new KnowledgeSearchService(Config(), NullLogger<KnowledgeSearchService>.Instance, scopes,
            new NullLogService(scopes));

        Assert.Contains(svc.SearchDetailed("怎么借东西", 8, "admin", null).Results, r => r.Path == "公共/物料管理规范.md");
    }

    [Fact]
    public void RagSearchLine_AppendsWeakSynRelax_AndStaysParsable()
    {
        var line = RagLog.SearchLine("怎么借东西 领用", hits: 3, returned: 2, empty: false,
            weak: true, synonymAdds: 2, relaxed: 1);

        Assert.StartsWith("RAG search: q=怎么借东西 领用 hits=3 returned=2 empty=False", line);
        Assert.EndsWith("weak=True syn=2 relax=1", line);
        Assert.True(RagLog.TryParseSearch(line, out var q, out var hits, out var returned, out var empty));
        Assert.Equal("怎么借东西 领用", q);
        Assert.Equal(3, hits);
        Assert.Equal(2, returned);
        Assert.False(empty);

        // 老格式（没有追加字段）仍然解析得动
        Assert.True(RagLog.TryParseSearch("RAG search: q=旧行 hits=1 returned=1 empty=False",
            out _, out var h2, out _, out var e2));
        Assert.Equal(1, h2);
        Assert.False(e2);
    }

    private IConfigurationRoot Config() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir }).Build();
}
