using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 只补齐缺失文档（省钱路径）。核心不变量：
///   1) 目录已存在 → 不重跑目录生成
///   2) 没有缺失 → 一次 AI 调用都不发生
///   3) 源码工作区拿不到 → 在调用 AI 之前就失败（不会白花钱）
/// 背景：大仓库全量重跑成本极高，而缺失的往往只是几篇文档。
/// </summary>
public class WikiRetryMissingTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly string _kbRoot;
    private readonly StubHttpHandler _ai = new(_ => new HttpResponseMessage());
    private readonly KnowledgeService _knowledge;

    public WikiRetryMissingTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        _kbRoot = Path.Combine(Path.GetTempPath(), $"tp-kb-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_kbRoot);
        var scopes = new TestScopeFactory(_db);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbRoot })
            .Build();
        _knowledge = new KnowledgeService(config, new NullLogService(scopes), scopes);
    }

    public void Dispose()
    {
        try { Directory.Delete(_kbRoot, true); } catch { /* best effort */ }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private WikiGeneratorService Create()
    {
        var scopes = new TestScopeFactory(_db);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbRoot })
            .Build();
        return new WikiGeneratorService(_db, _knowledge, config, new HttpClient(_ai),
            NullLogger<WikiGeneratorService>.Instance, new WikiProgressTracker());
    }

    private async Task<WikiTask> Seed(string catalogJson, string sourceUrl = "archive::bm9wZQ==", string status = "completed")
    {
        var task = new WikiTask
        {
            Id = "task-1", Type = "zip", ProjectName = "wiki1", TargetFolder = "公共",
            SourceUrl = sourceUrl, CatalogJson = catalogJson, Status = status,
            ErrorMessage = "有 1 篇文档未生成",
        };
        _db.WikiTasks.Add(task);
        await _db.SaveChangesAsync();
        return task;
    }

    private void WriteDoc(string relativePath, string content = "# doc")
    {
        var full = Path.Combine(_kbRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }

    private static string Catalog(params string[] paths) =>
        "[" + string.Join(",", paths.Select(p => $"{{\"path\":\"{p}\",\"title\":\"t\"}}")) + "]";

    [Fact]
    public async Task GetMissingDocuments_ListsOnlyAbsentFiles()
    {
        var svc = Create();
        await Seed(Catalog("a/exists", "b/missing"));
        WriteDoc("公共/wiki1/a/exists.md");

        var info = await svc.GetMissingDocuments("task-1");

        Assert.NotNull(info);
        Assert.Equal(2, info!.Value.Total);
        Assert.Equal(["b/missing"], info.Value.Missing);
    }

    [Fact]
    public async Task GetMissingDocuments_UnknownTask_ReturnsNull()
        => Assert.Null(await Create().GetMissingDocuments("nope"));

    [Fact]
    public async Task Retry_WithoutCatalog_RefusesWithoutAiCalls()
    {
        var svc = Create();
        await Seed("");

        var result = await svc.RetryMissingDocuments("task-1");

        Assert.False(result.Ok);
        Assert.Contains("没有目录信息", result.Message);
        Assert.Equal(0, _ai.Calls);
    }

    [Fact]
    public async Task Retry_NothingMissing_CostsNothing()
    {
        var svc = Create();
        await Seed(Catalog("a/one", "a/two"));
        WriteDoc("公共/wiki1/a/one.md");
        WriteDoc("公共/wiki1/a/two.md");

        var result = await svc.RetryMissingDocuments("task-1");

        Assert.True(result.Ok);
        Assert.Equal(0, result.Missing);
        Assert.Contains("没有缺失", result.Message);
        Assert.Equal(0, _ai.Calls);
        // 任务状态不该被无谓地改动
        Assert.Equal("completed", (await _db.WikiTasks.FindAsync("task-1"))!.Status);
    }

    [Fact]
    public async Task Retry_SourceArchiveGone_FailsBeforeAnyAiCall()
    {
        var svc = Create();
        // zip 归档指向一个不存在的路径：PrepareWorkspace 会先抛 FileNotFoundException
        var bogus = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(Path.Combine(_kbRoot, "gone.zip")));
        await Seed(Catalog("a/missing"), sourceUrl: bogus);

        var result = await svc.RetryMissingDocuments("task-1");

        Assert.False(result.Ok);
        Assert.Equal(1, result.Missing);
        // 关键：源码拿不到时在调用 AI 之前就失败——用户不会为失败白付钱
        Assert.Equal(0, _ai.Calls);
        var task = await _db.WikiTasks.FindAsync("task-1");
        Assert.Equal("failed", task!.Status);
        Assert.Contains("补齐文档失败", task.ErrorMessage);
    }

    [Fact]
    public async Task Retry_ReusesExistingWorkspace_InsteadOfRefetchingSource()
    {
        var svc = Create();
        var workspace = Path.Combine(_kbRoot, "workspace");
        Directory.CreateDirectory(workspace);
        File.WriteAllText(Path.Combine(workspace, "main.py"), "print('hi')");

        var task = await Seed(Catalog("a/missing"),
            sourceUrl: "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(Path.Combine(_kbRoot, "gone.zip"))));
        task.WorkspacePath = workspace;   // 上次生成留下的工作区
        await _db.SaveChangesAsync();

        // 复用工作区后，就不会因为 zip 归档缺失而失败了（失败点从"准备源码"挪到了 AI 调用）
        var result = await svc.RetryMissingDocuments("task-1");

        Assert.False(result.Ok);              // AI 未配置，仍会失败
        Assert.DoesNotContain("ZIP file not found", result.Message);
    }

    [Fact]
    public async Task Diagnose_ShowsWhereFilesLive_AndWhatIsRecoverable()
    {
        var svc = Create();
        await Seed(Catalog("a/exists", "b/recoverable", "c/gone"));
        WriteDoc("公共/wiki1/a/exists.md", "keep");
        // b/recoverable：曾经写过并被覆盖 → .history 里有备份，可零成本恢复
        _knowledge.WriteFile("公共/wiki1/b/recoverable.md", "v1");
        _knowledge.WriteFile("公共/wiki1/b/recoverable.md", "v2");
        File.Delete(Path.Combine(_kbRoot, "公共", "wiki1", "b", "recoverable.md"));

        var diag = await svc.DiagnoseTask("task-1");

        Assert.NotNull(diag);
        Assert.Equal("公共/wiki1", diag!.ProjectDir);
        Assert.Equal(_kbRoot, diag.KbRoot);
        Assert.Equal(["b/recoverable", "c/gone"], diag.Missing);
        Assert.Equal(["b/recoverable"], diag.RecoverableFromHistory);
        var existing = diag.Documents.Single(d => d.Path == "a/exists");
        Assert.True(existing.Exists);
        Assert.Equal("公共/wiki1/a/exists.md", existing.RelativeFile);
        Assert.Equal(0, _ai.Calls);   // 诊断是纯文件检查
    }

    [Fact]
    public async Task RestoreFromHistory_RecoversMissingDoc_WithoutAnyAiCall()
    {
        var svc = Create();
        await Seed(Catalog("b/lost"), status: "completed");
        _knowledge.WriteFile("公共/wiki1/b/lost.md", "restored-content");
        _knowledge.WriteFile("公共/wiki1/b/lost.md", "newer-content");
        File.Delete(Path.Combine(_kbRoot, "公共", "wiki1", "b", "lost.md"));

        var result = await svc.RestoreMissingFromHistory("task-1");

        Assert.True(result.Ok);
        Assert.Equal(0, result.StillMissing);
        Assert.Equal("restored-content", _knowledge.GetContent("公共/wiki1/b/lost.md"));
        Assert.Equal(0, _ai.Calls);   // 关键：零 AI 成本
    }

    [Fact]
    public async Task RestoreFromHistory_NoHistory_ReportsItNeedsAi()
    {
        var svc = Create();
        await Seed(Catalog("c/never-written"), status: "completed");

        var result = await svc.RestoreMissingFromHistory("task-1");

        Assert.False(result.Ok);
        Assert.Contains("没有可恢复的历史版本", result.Message);
        Assert.Equal(1, result.StillMissing);
        Assert.Equal(0, _ai.Calls);
    }

    [Fact]
    public async Task RestoreFromHistory_NothingMissing_IsNoOp()
    {
        var svc = Create();
        await Seed(Catalog("a/one"), status: "completed");
        WriteDoc("公共/wiki1/a/one.md");

        var result = await svc.RestoreMissingFromHistory("task-1");

        Assert.True(result.Ok);
        Assert.Contains("无需恢复", result.Message);
        Assert.Equal(0, _ai.Calls);
    }
}
