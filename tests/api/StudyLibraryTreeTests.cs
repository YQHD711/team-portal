using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 与真实知识库扫描对接：KnowledgeService.GetTree → StudyLibraryService.Build。
///
/// 另一组用例里的树是手搓的；这里喂**真的 ScanDirectory 产物**（Extra["ext"]、folder/file 类型、
/// 文件名排序），验证消费端对得上 —— 否则容易出现"单测全绿、线上一个课时都看不到"。
/// </summary>
public class StudyLibraryTreeTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly KnowledgeService _svc;

    public StudyLibraryTreeTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-study-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共", "学习库", "01-入门筑基"));
        Directory.CreateDirectory(Path.Combine(_kbDir, "飞训部", "学习库", "01-飞训专用"));
        // 工程部有目录但没有「学习库」子目录 → 不应出现作用域
        Directory.CreateDirectory(Path.Combine(_kbDir, "工程部", "结构设计"));
        File.WriteAllText(Path.Combine(_kbDir, "公共", "学习库", "_学习路径.md"), "# 路径");
        File.WriteAllText(Path.Combine(_kbDir, "公共", "学习库", "01-入门筑基", "_阶段说明.md"), "# 阶段");
        File.WriteAllText(Path.Combine(_kbDir, "公共", "学习库", "01-入门筑基", "01-认识航模.md"), "# 课时");
        File.WriteAllText(Path.Combine(_kbDir, "公共", "学习库", "01-入门筑基", "素材.txt"), "x");
        File.WriteAllText(Path.Combine(_kbDir, "飞训部", "学习库", "01-飞训专用", "01-起降训练.md"), "# 课时");

        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
        var scopes = new TestScopeFactory(_db);
        _svc = new KnowledgeService(config, new NullLogService(scopes), scopes);
    }

    [Fact]
    public void Build_FromRealScan_ProducesStagesAndLessons()
    {
        var scopes = StudyLibraryService.Build(_svc.GetTree("member", "飞训部"), "member", "飞训部");

        Assert.Equal(new[] { "公共", "飞训部" }, scopes.Select(s => s.Scope));
        Assert.All(scopes, s => Assert.False(s.CanEdit));

        var pub = scopes[0];
        Assert.Equal("公共/学习库", pub.LibraryPath);
        Assert.Equal("公共/学习库/_学习路径.md", pub.OverviewPath);

        var stage = Assert.Single(pub.Stages);
        Assert.Equal("入门筑基", stage.Title);
        Assert.Equal("公共/学习库/01-入门筑基/_阶段说明.md", stage.DescriptionPath);
        Assert.Equal(new[] { "认识航模" }, stage.Lessons.Select(l => l.Title));   // 素材.txt 不是课时

        var dept = scopes[1];
        Assert.Equal("飞训部学习库", dept.Label);
        Assert.Equal("起降训练", Assert.Single(Assert.Single(dept.Stages).Lessons).Title);
    }

    [Fact]
    public void RealScan_AlreadyHidesOtherDepartments()
    {
        var tree = _svc.GetTree("member", "飞训部");

        // 可见性由知识库树保证；学习库这边不得再引入第二条判定路径
        Assert.DoesNotContain(tree, n => n.Path == "工程部");
        Assert.DoesNotContain(StudyLibraryService.Build(tree, "member", "飞训部"), s => s.Scope == "工程部");
    }

    [Fact]
    public void Admin_SeesScopesThatActuallyHaveLibraryFolder()
    {
        var scopes = StudyLibraryService.Build(_svc.GetTree("admin", null), "admin", null);

        // 工程部扫描得到，但没有「学习库」子目录 → 不出现空作用域
        Assert.Equal(new[] { "公共", "飞训部" }, scopes.Select(s => s.Scope));
        Assert.All(scopes, s => Assert.True(s.CanEdit));
    }

    [Fact]
    public void LessonContent_IsReachableThroughTheSameAcl()
    {
        var scopes = StudyLibraryService.Build(_svc.GetTree("member", "飞训部"), "member", "飞训部");
        var lesson = scopes[0].Stages[0].Lessons[0];

        // 前端拿的是这个 path 去调 /api/knowledge/content，必须真能读到
        Assert.True(_svc.CanAccess(lesson.Path, "member", "飞训部"));
        Assert.Contains("课时", _svc.GetContent(lesson.Path));
    }

    public void Dispose()
    {
        _db.Dispose();
        try { Directory.Delete(_kbDir, true); } catch { /* 清理失败无需处理 */ }
    }
}
