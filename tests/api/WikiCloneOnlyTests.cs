using System.IO.Compression;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 「仅克隆」与「重新克隆」。
///
/// 背景：Wiki 工作区建在容器 /tmp（未挂卷），部署重建容器就整片清空，
/// 于是任务记录还在、源码浏览 /blob 全部 404。恢复源码只能重新克隆——
/// 必须做到「只下载源码、不调用 AI、不产生文档」，失败时还不能留下半成品目录。
/// </summary>
public class WikiCloneOnlyTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly string _kbRoot;
    private readonly string _tmp;
    private readonly string _wsRoot;
    private readonly StubHttpHandler _ai = new(_ => new HttpResponseMessage());
    private readonly KnowledgeService _knowledge;
    private readonly List<string> _taskIds = [];

    public WikiCloneOnlyTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        _kbRoot = Path.Combine(Path.GetTempPath(), $"tp-kb-{Guid.NewGuid():N}");
        _tmp = Path.Combine(Path.GetTempPath(), $"tp-files-{Guid.NewGuid():N}");
        _wsRoot = Path.Combine(Path.GetTempPath(), $"tp-ws-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_kbRoot);
        Directory.CreateDirectory(_tmp);
        Directory.CreateDirectory(_wsRoot);
        var scopes = new TestScopeFactory(_db);
        var config = Config();
        _knowledge = new KnowledgeService(config, new NullLogService(scopes), scopes);
    }

    /// <summary>工作区根目录改成测试临时目录（生产默认 /data/wiki-workspaces）。</summary>
    private IConfigurationRoot Config() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Knowledge:BasePath"] = _kbRoot,
            ["Wiki:WorkspaceRoot"] = _wsRoot,
        })
        .Build();

    /// <summary>某任务的工作区目录（与 WorkspaceDirAsync 同构）。</summary>
    private string WsDir(string taskId) => Path.Combine(_wsRoot, taskId);

    public void Dispose()
    {
        foreach (var dir in new[] { _kbRoot, _tmp, _wsRoot })
        {
            try { Directory.Delete(dir, true); } catch { /* best effort */ }
        }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private WikiGeneratorService Create() =>
        new(_db, _knowledge, Config(), new HttpClient(_ai),
            NullLogger<WikiGeneratorService>.Instance, new WikiProgressTracker());

    private string NewId() { var id = $"clone-{Guid.NewGuid():N}"; _taskIds.Add(id); return id; }

    /// <summary>造一个真实 zip（源码打包上传的等价物）。</summary>
    private string MakeZip(params (string Entry, string Body)[] files)
    {
        var zipPath = Path.Combine(_tmp, $"{Guid.NewGuid():N}.zip");
        using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
        foreach (var (entryPath, content) in files)
        {
            using var writer = new StreamWriter(zip.CreateEntry(entryPath).Open());
            writer.Write(content);
        }
        return zipPath;
    }

    private async Task<WikiTask> Seed(WikiTask task)
    {
        _taskIds.Add(task.Id);
        _db.WikiTasks.Add(task);
        await _db.SaveChangesAsync();
        return task;
    }

    [Fact]
    public async Task SubmitCloneOnly_IsTerminalWithSource_AndGeneratesNoDocuments()
    {
        var zip = MakeZip(("src/PixelToGPSConverter.h", "int main(){}"));

        var result = await Create().SubmitCloneOnly("zip", WikiGeneratorService.EncodeZipSource(zip), "proj", "公共", 1, "public");

        Assert.True(result.Ok, result.Message);
        var task = result.Task!;
        _taskIds.Add(task.Id);
        Assert.True(task.CloneOnly);
        Assert.Equal("completed", task.Status);          // 终结态：不会停在 pending 等 worker
        Assert.Null(task.CatalogJson);                   // 不生成任何文档
        Assert.True(File.Exists(Path.Combine(task.WorkspacePath!, "src", "PixelToGPSConverter.h")));
        var persisted = await _db.WikiTasks.FindAsync(task.Id);
        Assert.Equal(task.WorkspacePath, persisted!.WorkspacePath); // WorkspacePath 已写库
        Assert.Equal(0, _ai.Calls);                      // 一分钱 AI 都没花
    }

    [Fact]
    public async Task SubmitCloneOnly_Failure_CreatesNoTaskAtAll()
    {
        var missing = WikiGeneratorService.EncodeZipSource(Path.Combine(_tmp, "does-not-exist.zip"));

        var result = await Create().SubmitCloneOnly("zip", missing, "proj", "公共", 1, "public");

        Assert.False(result.Ok);
        Assert.Null(result.Task);
        Assert.Contains("源码拉取失败", result.Message);
        Assert.Equal(0, await _db.WikiTasks.CountAsync());  // 不留下查不到源码的失败任务
    }

    [Fact]
    public async Task CloneWorkspaceOnly_RestoresLostWorkspace_WithoutTouchingDocuments()
    {
        var zip = MakeZip(("src/PixelToGPSConverter.h", "// recovered"));
        var id = NewId();
        var catalog = "[{\"path\":\"src\",\"title\":\"t\"}]";
        await Seed(new WikiTask
        {
            Id = id, Type = "zip", SourceUrl = WikiGeneratorService.EncodeZipSource(zip),
            ProjectName = "proj", TargetFolder = "公共", Status = "completed", CatalogJson = catalog,
        });
        Assert.False(Directory.Exists(WsDir(id))); // 部署重建后工作区已丢失

        var result = await Create().CloneWorkspaceOnly(id);

        Assert.True(result.Ok, result.Message);
        var fresh = await _db.WikiTasks.FindAsync(id);
        Assert.True(Directory.Exists(fresh!.WorkspacePath));
        Assert.True(File.Exists(Path.Combine(fresh.WorkspacePath!, "src", "PixelToGPSConverter.h")));
        Assert.Equal("completed", fresh.Status);       // 文档任务的状态不被克隆改动
        Assert.Equal(catalog, fresh.CatalogJson);      // 目录/文档原样不动
        Assert.Equal(0, _ai.Calls);

        // 再丢一次仍能再恢复（幂等，不依赖上次的残留）
        Directory.Delete(WsDir(id), true);
        Assert.True((await Create().CloneWorkspaceOnly(id)).Ok);
        Assert.True(Directory.Exists((await _db.WikiTasks.FindAsync(id))!.WorkspacePath));
    }

    [Fact]
    public async Task CloneWorkspaceOnly_ExistingWorkspace_DoesNotRefetch()
    {
        var dir = Path.Combine(_tmp, "keep-me");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "kept.txt"), "x");
        var id = NewId();
        await Seed(new WikiTask
        {
            Id = id, Type = "zip", SourceUrl = WikiGeneratorService.EncodeZipSource(Path.Combine(_tmp, "gone.zip")),
            ProjectName = "proj", TargetFolder = "公共", Status = "completed", WorkspacePath = dir,
        });

        var result = await Create().CloneWorkspaceOnly(id);   // 源已不存在：若真去重下就会失败

        Assert.True(result.Ok);
        Assert.Contains("已存在", result.Message);
        Assert.True(File.Exists(Path.Combine(dir, "kept.txt")));
    }

    [Fact]
    public async Task CloneWorkspaceOnly_CloneOnlyTaskFailure_MarksFailedAndWritesNoBadPath()
    {
        var id = NewId();
        await Seed(new WikiTask
        {
            Id = id, Type = "zip", SourceUrl = WikiGeneratorService.EncodeZipSource(Path.Combine(_tmp, "gone.zip")),
            ProjectName = "proj", TargetFolder = "公共", Status = "pending", CloneOnly = true,
        });

        var result = await Create().CloneWorkspaceOnly(id);

        Assert.False(result.Ok);
        var fresh = await _db.WikiTasks.FindAsync(id);
        Assert.Equal("failed", fresh!.Status);
        Assert.Null(fresh.WorkspacePath);                       // 坏路径绝不写库
        Assert.Contains("源码拉取失败", fresh.ErrorMessage);
    }

    [Fact]
    public async Task CloneWorkspaceOnly_Failure_LeavesNoHalfBakedWorkspaceDir()
    {
        var id = NewId();
        var baseDir = WsDir(id);
        Directory.CreateDirectory(baseDir);
        File.WriteAllText(Path.Combine(baseDir, "half-cloned.txt"), "partial"); // 上次克隆的半成品
        var brokenZip = Path.Combine(_tmp, "broken.zip");
        File.WriteAllText(brokenZip, "this is not a zip");
        await Seed(new WikiTask
        {
            Id = id, Type = "zip", SourceUrl = WikiGeneratorService.EncodeZipSource(brokenZip),
            ProjectName = "proj", TargetFolder = "公共", Status = "pending", CloneOnly = true,
        });

        var result = await Create().CloneWorkspaceOnly(id);

        Assert.False(result.Ok);
        Assert.False(Directory.Exists(baseDir));   // 半成品目录必须被清掉，否则诊断会说「工作区还在」
    }

    [Fact]
    public async Task ProcessTask_CloneOnlyTask_SkipsTheWholeAiPipeline()
    {
        var zip = MakeZip(("main.py", "print('hi')"));
        var id = NewId();
        await Seed(new WikiTask
        {
            Id = id, Type = "zip", SourceUrl = WikiGeneratorService.EncodeZipSource(zip),
            ProjectName = "proj", TargetFolder = "公共", Status = "pending", CloneOnly = true,
        });

        await Create().ProcessTask(id);

        var fresh = await _db.WikiTasks.FindAsync(id);
        Assert.Equal("completed", fresh!.Status);
        Assert.True(File.Exists(Path.Combine(fresh.WorkspacePath!, "main.py")));
        Assert.Null(fresh.CatalogJson);
        Assert.Equal(0, _ai.Calls);
    }
}
