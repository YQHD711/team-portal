using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 知识库检索的权限过滤:索引覆盖全部部门目录,
/// 检索结果必须按调用者角色/部门 + wiki 项目 Visibility 过滤。
/// </summary>
public class KnowledgeSearchAclTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly KnowledgeSearchService _search;

    public KnowledgeSearchAclTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-kbsearch-{Guid.NewGuid():N}");
        foreach (var dir in new[] { "公共", "飞训部", "组织部", Path.Combine("飞训部", "PrivateProj") })
            Directory.CreateDirectory(Path.Combine(_kbDir, dir));
        File.WriteAllText(Path.Combine(_kbDir, "公共", "pub.md"), "secret public doc");
        File.WriteAllText(Path.Combine(_kbDir, "飞训部", "dept.md"), "secret flight dept doc");
        File.WriteAllText(Path.Combine(_kbDir, "组织部", "other.md"), "secret org dept doc");
        File.WriteAllText(Path.Combine(_kbDir, "飞训部", "PrivateProj", "p.md"), "secret private wiki doc");

        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        _db.Database.EnsureCreated();
        // 他人的 personal wiki 项目:对 uid=1 不可见(项目目录位于部门目录之下)
        _db.WikiTasks.Add(new WikiTask
        {
            Id = "task-private", ProjectName = "PrivateProj", TargetFolder = "飞训部",
            Visibility = "personal", UserId = 99, Status = "completed"
        });
        _db.SaveChanges();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
        _search = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance, new TestScopeFactory(_db));
    }

    [Fact]
    public void Member_OnlySeesOwnDepartmentAndPublicDocs()
    {
        var paths = _search.Search("secret", 10, "member", "飞训部", 1).Select(r => r.Path).ToList();

        Assert.Contains("公共/pub.md", paths);
        Assert.Contains("飞训部/dept.md", paths);
        Assert.DoesNotContain("组织部/other.md", paths);
    }

    [Fact]
    public void Member_DoesNotSeeOthersPersonalWikiProject()
    {
        var paths = _search.Search("secret", 10, "member", "飞训部", 1).Select(r => r.Path).ToList();

        Assert.DoesNotContain("飞训部/PrivateProj/p.md", paths);
    }

    [Fact]
    public void ProjectOwner_SeesOwnPersonalWikiProject()
    {
        var paths = _search.Search("secret", 10, "member", "飞训部", 99).Select(r => r.Path).ToList();

        Assert.Contains("飞训部/PrivateProj/p.md", paths);
    }

    [Fact]
    public void Admin_SeesEverything()
    {
        var paths = _search.Search("secret", 10, "admin", null, 0).Select(r => r.Path).ToList();

        Assert.Contains("公共/pub.md", paths);
        Assert.Contains("飞训部/dept.md", paths);
        Assert.Contains("组织部/other.md", paths);
        Assert.Contains("飞训部/PrivateProj/p.md", paths);
    }

    [Fact]
    public void TopK_AppliesAfterAclFiltering()
    {
        // topK 必须在过滤之后生效:否则无权文档会挤掉有权文档的名额
        var paths = _search.Search("secret", 2, "member", "飞训部", 1).Select(r => r.Path).ToList();

        Assert.Equal(2, paths.Count);
        Assert.All(paths, p => Assert.DoesNotContain("组织部", p));
    }

    public void Dispose()
    {
        _search.Dispose();
        try { Directory.Delete(_kbDir, true); } catch { /* 清理失败忽略 */ }
    }
}
