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
/// Wiki 工作区相关测试的公共夹具：内存 SQLite + 三个临时目录（知识库 / 文件 / 工作区根）。
/// 工作区根目录指向测试临时目录，避免在开发机/CI 上写 /data。
/// </summary>
public abstract class WikiWorkspaceTestBase : IDisposable
{
    protected readonly AppDbContext Db;
    private readonly StubHttpHandler _ai = new(_ => new HttpResponseMessage());
    protected readonly KnowledgeService Knowledge;
    protected readonly string KbRoot;
    protected readonly string Tmp;
    protected readonly string WsRoot;

    protected WikiWorkspaceTestBase()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        Db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        Db.Database.EnsureCreated();
        KbRoot = Path.Combine(Path.GetTempPath(), $"tp-kb-{Guid.NewGuid():N}");
        Tmp = Path.Combine(Path.GetTempPath(), $"tp-files-{Guid.NewGuid():N}");
        WsRoot = Path.Combine(Path.GetTempPath(), $"tp-ws-{Guid.NewGuid():N}");
        Directory.CreateDirectory(KbRoot);
        Directory.CreateDirectory(Tmp);
        Directory.CreateDirectory(WsRoot);
        Knowledge = new KnowledgeService(Config(), new NullLogService(new TestScopeFactory(Db)), new TestScopeFactory(Db));
    }

    protected IConfigurationRoot Config(string? workspaceRoot = null, string? keep = null)
    {
        var pairs = new Dictionary<string, string?> { ["Knowledge:BasePath"] = KbRoot };
        if (workspaceRoot is not null) pairs["Wiki:WorkspaceRoot"] = workspaceRoot;
        if (keep is not null) pairs["Wiki:WorkspaceKeep"] = keep;
        return new ConfigurationBuilder().AddInMemoryCollection(pairs).Build();
    }

    /// <summary>工作区默认指向测试临时根目录（生产默认 /data/wiki-workspaces）。</summary>
    protected WikiGeneratorService Create(string? workspaceRoot = null, string? keep = null) =>
        new(Db, Knowledge, Config(workspaceRoot, keep), new HttpClient(_ai),
            NullLogger<WikiGeneratorService>.Instance, new WikiProgressTracker());

    protected string WsDir(string taskId) => Path.Combine(WsRoot, taskId);

    protected async Task SetSetting(string key, string value)
    {
        Db.SystemSettings.Add(new SystemSetting { Key = key, Value = value, Category = "系统参数", Description = "test" });
        await Db.SaveChangesAsync();
    }

    protected async Task SeedTask(string id, string status = "completed", DateTime? completedAt = null)
    {
        Db.WikiTasks.Add(new WikiTask
        {
            Id = id, Type = "zip", SourceUrl = "archive::x", ProjectName = id, TargetFolder = "公共",
            Status = status, CompletedAt = completedAt,
        });
        await Db.SaveChangesAsync();
    }

    protected void MakeWorkspace(string taskId)
    {
        Directory.CreateDirectory(Path.Combine(WsDir(taskId), "repo"));
        File.WriteAllText(Path.Combine(WsDir(taskId), "repo", "a.h"), "src");
    }

    /// <summary>造一个真实 zip（源码打包上传的等价物）。</summary>
    protected string MakeZip(string entry = "a.h")
    {
        var zip = Path.Combine(Tmp, "src.zip");
        using var z = ZipFile.Open(zip, ZipArchiveMode.Create);
        using var w = new StreamWriter(z.CreateEntry(entry).Open());
        w.Write("int a;");
        return zip;
    }

    public void Dispose()
    {
        foreach (var dir in new[] { KbRoot, Tmp, WsRoot })
        {
            try { Directory.Delete(dir, true); } catch { /* best effort */ }
        }
        Db.Dispose();
        GC.SuppressFinalize(this);
    }
}
