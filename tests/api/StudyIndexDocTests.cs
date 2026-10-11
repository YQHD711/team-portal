using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P1-2：学习库（阶段/课时结构）导出成检索侧**虚拟索引文档**，让「工程部怎么学」这类中文提问命中。
///
/// 检到的层次：**检索命中 + 提示词规则**。最终答句由模型生成，这里测不到（见回报里的说明）。
/// 数据源与 /study 页面共用 StudyLibraryService.Build/Enrich，不复制第二套解析。
/// </summary>
public class StudyIndexDocTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly IConfigurationRoot _config;

    public StudyIndexDocTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-studydoc-{Guid.NewGuid():N}");
        Seed(_kbDir);
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

    /// <summary>两个部门各一个学习库：工程部 2 个阶段 3 课，电子部 1 个阶段 1 课。</summary>
    private static void Seed(string kb)
    {
        void Write(string rel, string content)
        {
            var full = Path.Combine(kb, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
        }

        Write("工程部/学习库/_学习路径.md",
            "# 工程部学习路径\n\n> 中飞院航模队工程部：机体结构设计与制造。\n\n## 阶段总览\n\n" +
            "| 阶段 | 周期 |\n|---|---|\n| 01-工程基础 | 3-4 周（全员必修） |\n| 02-SolidWorks教程 | 4-6 周 |\n\n" +
            "## 学习方式\n\n- 按阶段顺序推进，每课都有考核，**不验收不算学完**。\n");
        Write("工程部/学习库/01-工程基础/_阶段说明.md",
            "---\n时长: 3-4 周\n目标: 看懂图纸与公差\n---\n\n## 阶段门槛\n\n- 能独立识图\n- 掌握队内量具\n");
        Write("工程部/学习库/01-工程基础/01-投影与视图表达.md", "# 课时");
        Write("工程部/学习库/01-工程基础/02-公差与配合.md", "# 课时");
        Write("工程部/学习库/02-SolidWorks教程/_阶段说明.md", "---\n时长: 4-6 周\n---\n\n草图/特征/装配/工程图。");
        Write("工程部/学习库/02-SolidWorks教程/01-草图绘制.md", "# 课时");

        Write("公共/安全规范.md", "飞行前检查单与安全红线：上电前确认遥控器油门归零。");
        Write("电子部/学习库/_学习路径.md", "# 电子部学习路径\n\n> 电子部：飞控与电子设备。\n");
        Write("电子部/学习库/01-电子基础/01-元器件识别.md", "# 课时");
    }

    private KnowledgeService Knowledge() =>
        new(_config, new NullLogService(new TestScopeFactory(_db)), new TestScopeFactory(_db));

    [Fact]
    public void Build_ProducesOneDocPerDepartment_WithStagesLessonsAndOverview()
    {
        var docs = StudyIndexDocBuilder.Build(Knowledge());

        Assert.Equal(2, docs.Count);   // 每部门一份
        var eng = docs.Single(d => d.Path.StartsWith("工程部/"));
        Assert.Equal("工程部/学习库/_学习路径.md", eng.Path);
        Assert.Contains("工程部", eng.Text);
        Assert.Contains("01-工程基础", eng.Text);            // 阶段总览原文（含排序前缀）
        Assert.Contains("工程基础", eng.Text);               // 文件名的排序前缀已剥掉
        Assert.Contains("SolidWorks教程", eng.Text);
        Assert.Contains("投影与视图表达", eng.Text);          // 课时清单
        Assert.Contains("草图绘制", eng.Text);
        Assert.Contains("不验收不算学完", eng.Text);          // 门槛/规则来自 _学习路径.md
        Assert.Contains("看懂图纸与公差", eng.Text);          // 阶段说明的 front matter 目标
        Assert.True(eng.Text.IndexOf("工程基础", StringComparison.Ordinal)
                    < eng.Text.IndexOf("SolidWorks教程", StringComparison.Ordinal), "阶段要按顺序排列");
    }

    [Fact]
    public void Search_ChineseQuestion_FindsOwnDepartmentStudyDoc()
    {
        using var search = CreateSearch();

        var hits = search.Search("工程部怎么学", 5, "member", "工程部");

        var hit = hits.First();
        Assert.StartsWith("工程部/学习库/", hit.Path);
        Assert.Contains("工程基础", hit.Snippet);            // snippet 来自虚拟文档正文
        Assert.Contains("SolidWorks教程", hit.Snippet);
        Assert.Equal(2, search.IndexedVirtualCount);         // 两个部门两份虚拟文档
    }

    [Fact]
    public void Search_StudyDocs_FollowPathAcl()
    {
        using var search = CreateSearch();

        var otherDept = search.Search("工程部怎么学", 5, "member", "电子部");
        Assert.DoesNotContain(otherDept, r => r.Path.StartsWith("工程部/"));
        Assert.Contains(otherDept, r => r.Path.StartsWith("电子部/"));   // 本部门的还在（"怎么学"泛词命中）

        var admin = search.Search("工程部怎么学", 5, "admin", null);
        Assert.Contains(admin, r => r.Path == "工程部/学习库/_学习路径.md");
    }

    [Fact]
    public void Search_DoesNotBreakFileDocuments()
    {
        // 学习库导出不能把普通知识库文档挤出索引
        File.WriteAllText(Path.Combine(_kbDir, "公共", "安全规范.md"), "飞行前检查单与安全红线。");
        using var search = CreateSearch();

        var hits = search.Search("安全红线", 5, "admin", null);

        Assert.Contains(hits, r => r.Path == "公共/安全规范.md");
    }

    private KnowledgeSearchService CreateSearch() => new(_config, NullLogger<KnowledgeSearchService>.Instance,
        new TestScopeFactory(_db), new NullLogService(new TestScopeFactory(_db)));

    /// <summary>
    /// 用**真实知识库**跑一遍导出，把条数/字符量写到 %TEMP%\tp-study-docs.txt（回报实测数据用）。
    /// 默认跳过（临时 KB 之外还依赖仓库外的数据），设 TP_STUDY_DOC_KB=&lt;知识库路径&gt; 才执行。
    /// </summary>
    [Fact]
    public void Build_RealKnowledgeBase_WritesCountReport()
    {
        var kb = Environment.GetEnvironmentVariable("TP_STUDY_DOC_KB");
        if (string.IsNullOrWhiteSpace(kb)) return;

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = kb })
            .Build();
        var docs = StudyIndexDocBuilder.Build(new KnowledgeService(config,
            new NullLogService(new TestScopeFactory(_db)), new TestScopeFactory(_db)));

        var detail = string.Join("; ", docs.Select(d => $"{d.Path}={d.Text.Length}字"));
        var report = $"scopes={docs.Count} totalChars={docs.Sum(d => d.Text.Length)} :: {detail}";
        File.WriteAllText(Path.Combine(Path.GetTempPath(), "tp-study-docs.txt"), report);
        Console.WriteLine("[StudyDocs] " + report);
    }
}
