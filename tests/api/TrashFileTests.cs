using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 回收站的「文件保管」：知识库文档、wiki 项目目录这类删除必须留下**原始文件**，
/// 不能只写一行 JSON（文档可能几十 MB）。
///
/// 这里钉住几条安全性质：
/// 1) 删除 = 把文件/目录整体搬进保管区，原位置确实没了；
/// 2) 恢复 = 搬回原位置，内容一模一样；
/// 3) 原位置已被占用时**拒绝恢复**并保留回收站记录（绝不覆盖用户新建的文档）；
/// 4) 路径本来就不存在时删除照样能用（记录里没有保管项）；
/// 5) 带数据库行的删除（wiki 任务）恢复时文件与行一起回来。
/// </summary>
public class TrashFileTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly TrashService _trash;
    private readonly string _work;
    private readonly string _stash;

    public TrashFileTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();

        _work = Path.Combine(Path.GetTempPath(), $"tp-trash-{Guid.NewGuid():N}");
        _stash = Path.Combine(_work, "_stash");
        Directory.CreateDirectory(_work);
        TrashService.StashRoot = _stash;

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = $"Data Source={Path.Combine(_work, "teamportal.db")}"
        }).Build();
        var log = new NullLogService(new TestScopeFactory(_db));
        _trash = new TrashService(_db, log, new BackupService(config, new StubEnv { ContentRootPath = _work }, log));
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
        try { Directory.Delete(_work, true); } catch { /* 尽力而为 */ }
    }

    private string WriteFile(string relative, string content)
    {
        var full = Path.Combine(_work, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
        return full;
    }

    [Fact]
    public async Task Delete_MovesTheFileIntoTheStash_AndRestoreBringsItBack()
    {
        var file = WriteFile("公共/资料/说明.md", "原始内容");

        var item = _trash.StashPaths(new[] { file }, "知识库：公共/资料/说明.md", "KnowledgePath", 1, "admin");
        _db.TrashItems.Add(item);
        await _db.SaveChangesAsync();

        Assert.False(File.Exists(file));                                  // 原位置没了
        Assert.Single(Directory.GetFiles(_stash));                        // 保管区里有

        Assert.True(await _trash.Restore(item.Id));
        Assert.Equal("原始内容", File.ReadAllText(file));                  // 内容一字不差
        Assert.Empty(Directory.GetFiles(_stash));                         // 保管区清空
    }

    [Fact]
    public async Task Delete_MovesAWholeDirectory()
    {
        WriteFile("飞训部/学习库/01-入门/01-认识航模.md", "第一课");
        WriteFile("飞训部/学习库/01-入门/02-安全规范.md", "第二课");
        var dir = Path.Combine(_work, "飞训部/学习库/01-入门");

        var item = _trash.StashPaths(new[] { dir }, "知识库：飞训部/学习库/01-入门", "KnowledgePath", 1, "admin");
        _db.TrashItems.Add(item);
        await _db.SaveChangesAsync();

        Assert.False(Directory.Exists(dir));

        Assert.True(await _trash.Restore(item.Id));
        Assert.Equal("第一课", File.ReadAllText(Path.Combine(dir, "01-认识航模.md")));
        Assert.Equal("第二课", File.ReadAllText(Path.Combine(dir, "02-安全规范.md")));
    }

    [Fact]
    public async Task Restore_RefusesToOverwriteAnExistingPath()
    {
        var file = WriteFile("公共/资料/说明.md", "旧内容");
        var item = _trash.StashPaths(new[] { file }, "知识库：说明", "KnowledgePath", 1, "admin");
        _db.TrashItems.Add(item);
        await _db.SaveChangesAsync();

        // 删除后有人新建了同名文档：恢复必须放弃，且回收站记录保留
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, "新内容");

        Assert.False(await _trash.Restore(item.Id));
        Assert.Equal("新内容", File.ReadAllText(file));                     // 不覆盖
        Assert.NotNull(await _db.TrashItems.FindAsync(item.Id));           // 记录还在，还能手工处理
    }

    [Fact]
    public async Task Delete_OfMissingPath_StillWorks()
    {
        var missing = Path.Combine(_work, "公共/不存在.md");

        var item = _trash.StashPaths(new[] { missing }, "知识库：不存在", "KnowledgePath", 1, "admin");
        _db.TrashItems.Add(item);
        await _db.SaveChangesAsync();

        Assert.True(await _trash.Restore(item.Id));   // 没有保管项 → 恢复即"无事可做"
    }

    [Fact]
    public async Task WikiTask_RestoresBothFolderAndRow()
    {
        WriteFile("公共/某项目/getting-started/intro.md", "项目文档");
        var folder = Path.Combine(_work, "公共/某项目");
        var task = new WikiTask { Id = "task-1", ProjectName = "某项目", TargetFolder = "公共", Status = "completed" };
        _db.WikiTasks.Add(task);
        await _db.SaveChangesAsync();

        var item = _trash.StashPaths(new[] { folder }, "Wiki 项目：某项目", "WikiTask", 1, "admin", row: task);
        _db.TrashItems.Add(item);
        _db.WikiTasks.Remove(task);            // 端点随后删掉任务行
        await _db.SaveChangesAsync();

        Assert.False(Directory.Exists(folder));
        Assert.Null(await _db.WikiTasks.FindAsync("task-1"));

        Assert.True(await _trash.Restore(item.Id));

        Assert.Equal("项目文档", File.ReadAllText(Path.Combine(folder, "getting-started/intro.md")));
        Assert.NotNull(await _db.WikiTasks.FindAsync("task-1"));   // 行也回来了，且主键不变
    }

    /// <summary>老的类型（纯 JSON 行）不能被新解析逻辑误伤。</summary>
    [Fact]
    public void ParseStashed_IgnoresNonFileRecords()
    {
        var inv = TrashService.NewItem("InventoryItem", 7, "桨叶", new InventoryItem { Name = "桨叶", Quantity = 1 }, 1, "admin");

        Assert.Null(TrashService.ParseStashed(inv.DataJson));
    }

    [Fact]
    public void ParseStashed_ReadsFileRecords()
    {
        var item = _trash.StashPaths(new[] { WriteFile("a.md", "x") }, "t", "KnowledgePath", 1, "admin");

        var parsed = TrashService.ParseStashed(item.DataJson);
        Assert.NotNull(parsed);
        Assert.Single(parsed!.Paths);
    }

    private sealed class StubEnv : Microsoft.AspNetCore.Hosting.IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Test";
        public string WebRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
