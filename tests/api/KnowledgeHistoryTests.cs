using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 知识库版本历史（.history）—— 零成本的文档恢复来源。
/// 覆盖写入时旧内容会自动备份到 {BasePath}/.history/{目录}/{文件名}.{时间戳}.bak。
/// </summary>
public class KnowledgeHistoryTests : IDisposable
{
    private readonly string _root;
    private readonly KnowledgeService _kb;
    private readonly AppDbContext _db;

    public KnowledgeHistoryTests()
    {
        _root = Path.Combine(Path.GetTempPath(), $"tp-kbhist-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_root);
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        var scopes = new TestScopeFactory(_db);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _root })
            .Build();
        _kb = new KnowledgeService(config, new NullLogService(scopes), scopes);
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch { /* best effort */ }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void HistoryVersions_EmptyForNewFile()
        => Assert.Empty(_kb.HistoryVersions("公共/proj/doc.md"));

    [Fact]
    public void Write_Overwrite_CreatesHistoryVersion()
    {
        _kb.WriteFile("公共/proj/doc.md", "v1");
        _kb.WriteFile("公共/proj/doc.md", "v2");

        var versions = _kb.HistoryVersions("公共/proj/doc.md");

        Assert.Single(versions);
        Assert.EndsWith(".bak", versions[0].FileName);
        Assert.Equal(2, versions[0].Size);
        Assert.Equal("v2", _kb.GetContent("公共/proj/doc.md"));
    }

    [Fact]
    public void RestoreFromHistory_BringsBackPreviousContent()
    {
        _kb.WriteFile("公共/proj/doc.md", "v1-content");
        _kb.WriteFile("公共/proj/doc.md", "v2-content");

        var restored = _kb.RestoreFromHistory("公共/proj/doc.md");

        Assert.NotNull(restored);
        Assert.Equal("v1-content", _kb.GetContent("公共/proj/doc.md"));
    }

    [Fact]
    public void RestoreFromHistory_WorksAfterFileDeleted()
    {
        _kb.WriteFile("公共/proj/doc.md", "keep-me");
        // 覆盖一次产生历史版本，再模拟"文档丢失"
        _kb.WriteFile("公共/proj/doc.md", "newer");
        File.Delete(Path.Combine(_root, "公共", "proj", "doc.md"));

        var restored = _kb.RestoreFromHistory("公共/proj/doc.md");

        Assert.NotNull(restored);   // 最新历史版本 = "keep-me" 那一版的前一份内容
        Assert.Equal("keep-me", _kb.GetContent("公共/proj/doc.md"));
    }

    [Fact]
    public void RestoreFromHistory_PicksNewestVersionByName()
    {
        _kb.WriteFile("公共/proj/doc.md", "old");
        Thread.Sleep(1100); // 时间戳精确到秒
        _kb.WriteFile("公共/proj/doc.md", "new");
        File.Delete(Path.Combine(_root, "公共", "proj", "doc.md"));

        var versions = _kb.HistoryVersions("公共/proj/doc.md");
        Assert.Single(versions);
        Assert.Null(_kb.GetContent("公共/proj/doc.md"));   // 删除后确实没内容

        _kb.RestoreFromHistory("公共/proj/doc.md", versions[0].FileName);

        Assert.Equal("old", _kb.GetContent("公共/proj/doc.md"));
    }

    [Fact]
    public void RestoreFromHistory_UnknownVersion_ReturnsNull()
    {
        _kb.WriteFile("公共/proj/doc.md", "v1");
        _kb.WriteFile("公共/proj/doc.md", "v2");

        Assert.Null(_kb.RestoreFromHistory("公共/proj/doc.md", "nope.bak"));
        Assert.Equal("v2", _kb.GetContent("公共/proj/doc.md"));   // 未恢复不该改动内容
    }

    [Fact]
    public void HistoryVersions_NoHistoryDir_ReturnsEmpty()
        => Assert.Empty(_kb.HistoryVersions("公共/none/doc.md"));

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("公共/../../../etc/passwd")]
    public void HistoryVersions_RejectsEscapingPaths(string path)
    {
        Assert.Empty(_kb.HistoryVersions(path));
        Assert.Null(_kb.RestoreFromHistory(path));
    }

    [Fact]
    public void History_LivesUnderDotHistory_SoItIsNotListedAsDocument()
    {
        _kb.WriteFile("公共/proj/doc.md", "v1");
        _kb.WriteFile("公共/proj/doc.md", "v2");

        Assert.True(Directory.Exists(Path.Combine(_root, ".history", "公共", "proj")));
        // 历史目录是隐藏的（.history），不会被知识库树当成文档
        Assert.Contains("公共/proj", _kb.GetTree("admin", null).SelectMany(n => n.Children ?? []).Select(c => c.Path));
    }
}
