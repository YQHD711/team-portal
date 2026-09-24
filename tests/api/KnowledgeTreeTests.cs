using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 知识库目录树的形状契约：
/// - 返回的是**根节点数组** `[公共知识库, 部门…]`，部门与公共平级
///   （前端曾只渲染 tree[0].children，导致部门下的文档在树里完全看不到）
/// - 点开头的目录（.history 备份仓等）是基础设施，绝不能进树 ——
///   否则会被当成资料目录，甚至能从界面上删掉/改名，把备份仓毁了
/// </summary>
public class KnowledgeTreeTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly KnowledgeService _svc;

    public KnowledgeTreeTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-ktree-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));
        Directory.CreateDirectory(Path.Combine(_kbDir, "组织部", "学习库"));
        // 基础设施目录 + 一个嵌套的点目录，都不该出现
        Directory.CreateDirectory(Path.Combine(_kbDir, ".history", "组织部"));
        Directory.CreateDirectory(Path.Combine(_kbDir, "组织部", ".cache"));
        File.WriteAllText(Path.Combine(_kbDir, "公共", "pub.md"), "# 公共");
        File.WriteAllText(Path.Combine(_kbDir, "组织部", "学习库", "a.md"), "# 部门课时");
        File.WriteAllText(Path.Combine(_kbDir, ".history", "组织部", "a.md.20260101-000000.bak"), "旧内容");
        File.WriteAllText(Path.Combine(_kbDir, "组织部", ".cache", "tmp.md"), "缓存");

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

    private static void CollectPaths(IEnumerable<TreeNode> nodes, List<string> into)
    {
        foreach (var n in nodes)
        {
            into.Add((n.Path ?? n.Name).Replace('\\', '/'));
            if (n.Children is not null) CollectPaths(n.Children, into);
        }
    }

    [Fact]
    public void Admin_Tree_HasPublicAndDepartmentAsSiblingRoots()
    {
        var roots = _svc.GetTree("admin", null);

        Assert.Equal(new[] { "公共", "组织部" }, roots.Select(r => r.Path));
    }

    [Fact]
    public void Member_Tree_HasPublicAndOwnDepartment()
    {
        var roots = _svc.GetTree("member", "组织部");

        Assert.Equal(new[] { "公共", "组织部" }, roots.Select(r => r.Path));
    }

    [Fact]
    public void HistoryAndDotDirs_AreNotInTheTree()
    {
        var paths = new List<string>();
        CollectPaths(_svc.GetTree("admin", null), paths);

        Assert.DoesNotContain(paths, p => p.StartsWith(".history", StringComparison.Ordinal));
        Assert.DoesNotContain(paths, p => p.Contains(".cache", StringComparison.Ordinal));
        Assert.DoesNotContain(paths, p => p.Contains(".bak", StringComparison.Ordinal));
    }

    [Fact]
    public void DepartmentContent_IsReachableInTheTree()
    {
        // 回归：部门下的文档必须能在树里找到（前端曾因为只渲染 tree[0].children 而看不到）
        var paths = new List<string>();
        CollectPaths(_svc.GetTree("admin", null), paths);

        Assert.Contains("组织部/学习库/a.md", paths);
    }

    public void Dispose()
    {
        _db.Dispose();
        try { Directory.Delete(_kbDir, true); } catch { /* 清理失败无需处理 */ }
    }
}
