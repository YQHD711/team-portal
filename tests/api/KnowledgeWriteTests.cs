using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 知识库写入的健壮性。
///
/// 线上现象：保存某些文档报 400「Access is denied」，路径是 `…/xx.md.tmp`，
/// 且只有个别目录里的文档中招。旧实现把临时文件写成固定的 `X.md.tmp`：
/// 只要宿主机上遗留了这么一个文件（例如早期以 root 运行的进程写下的），
/// 后续每次 WriteAllText 都会无权限失败 —— 那篇文档就永远存不进去，
/// 而 rename 覆盖目标只需要**目录**写权限，本来不该受这个文件影响。
/// </summary>
public class KnowledgeWriteTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly KnowledgeService _svc;

    public KnowledgeWriteTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-kwrite-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "飞训部", "学习库", "01-航模基础"));
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

    public void Dispose()
    {
        // 只读属性会让递归删除失败，先把文件恢复可写
        try
        {
            foreach (var f in Directory.GetFiles(_kbDir, "*", SearchOption.AllDirectories))
                File.SetAttributes(f, FileAttributes.Normal);
        }
        catch { /* 尽力而为 */ }
        _db.Dispose();
        try { Directory.Delete(_kbDir, true); } catch { /* 尽力而为 */ }
    }

    private const string Rel = "飞训部/学习库/01-航模基础/01-认识航模.md";

    private string MakeStaleTemp()
    {
        // 模拟宿主机上遗留、且当前进程改不动的旧临时文件（只读 = 不可覆盖）
        var stale = Path.Combine(_kbDir, "飞训部", "学习库", "01-航模基础", "01-认识航模.md.tmp");
        File.WriteAllText(stale, "上一次写入留下的垃圾");
        File.SetAttributes(stale, FileAttributes.ReadOnly);
        return stale;
    }

    [Fact]
    public void WriteFile_SucceedsEvenWhenAStaleTempFileIsInTheWay()
    {
        var stale = MakeStaleTemp();

        _svc.WriteFile(Rel, "# 新内容");

        Assert.Equal("# 新内容", _svc.GetContent(Rel));
        // 旧实现复用的正是这个名字，且它写不动 —— 卡死就是这么来的
        Assert.True(File.Exists(stale), "遗留的旧临时文件不该被当成目标或损坏");
    }

    [Fact]
    public void WriteFile_LeavesNoTempFileBehind_OnSuccess()
    {
        _svc.WriteFile(Rel, "# 内容");

        Assert.Empty(Directory.GetFiles(_kbDir, "*.tmp-*", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(_kbDir, "*.md.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public void WriteFile_OverwritesExistingDocument_AndKeepsHistory()
    {
        _svc.WriteFile(Rel, "第一版");
        _svc.WriteFile(Rel, "第二版");

        Assert.Equal("第二版", _svc.GetContent(Rel));
        Assert.NotEmpty(Directory.GetFiles(Path.Combine(_kbDir, ".history"), "*.bak", SearchOption.AllDirectories));
    }

    [Fact]
    public void WriteFile_Binary_AlsoAvoidsTheFixedTempName()
    {
        var stale = MakeStaleTemp();

        _svc.WriteFile("飞训部/学习库/01-航模基础/图片.png", new byte[] { 1, 2, 3 });

        Assert.Equal(new byte[] { 1, 2, 3 }, _svc.GetBinaryContent("飞训部/学习库/01-航模基础/图片.png"));
        Assert.True(File.Exists(stale));
    }
}
