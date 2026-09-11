using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// AI-powered code-to-wiki generator using DeepSeek function calling.
/// AI Agent reads source code via tools, generates catalog + documents.
/// Inspired by OpenDeepWiki WikiGenerator.
/// </summary>
/// <remarks>
/// 主类部分：字段、构造函数、DeepSeek 配置读取、任务管理（提交/查询/删除）与生成管线编排。
/// 其余职责拆分为 partial：Workspace（工作区准备）、DeepSeek（AI 调用+工具）、
/// Catalog（目录生成）、Documents（文档生成/复审）、Translate（翻译）。
/// </remarks>
public partial class WikiGeneratorService
{
    private readonly AppDbContext _db;
    private readonly KnowledgeService _knowledge;
    private readonly IConfiguration _config;
    private readonly HttpClient _http;
    private readonly ILogger<WikiGeneratorService> _logger;
    private readonly WikiProgressTracker _progress;
    private WikiGeneratorOptions _options;
    private string _workspacePath = "";
    private string _projectName = "";
    private string _targetFolder = "";
    private int _complexityScore = 3;
    private string _currentTaskId = "";
    private readonly List<string> _processedFiles = new();
    private string _catalogJson = "[]";
    private string? _currentModel;
    private string? _currentCatalogModel;
    private string? _customCatalogJson;

    private static readonly HashSet<string> ExcludedDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "node_modules", "bin", "obj", "dist", "build", ".git", ".svn", ".hg",
        ".idea", ".vscode", ".vs", "__pycache__", ".cache", "coverage",
        "packages", "vendor", ".next", ".nuxt", "target", "out", ".output"
    };

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public WikiGeneratorService(AppDbContext db, KnowledgeService knowledge, IConfiguration config, HttpClient http, ILogger<WikiGeneratorService> logger, WikiProgressTracker progress)
    {
        _db = db; _knowledge = knowledge; _config = config; _http = http; _logger = logger; _progress = progress;
        _options = WikiSettingsStore.Load().Options;
    }

    /// <summary>Get DeepSeek API key: DB SystemSettings first, then config, then env var.</summary>
    private async Task<string> GetApiKey()
    {
        var setting = await _db.SystemSettings.FindAsync("AI:DeepSeekKey");
        if (setting is not null && !string.IsNullOrEmpty(setting.Value)) return setting.Value;
        return _config["AiService:DeepSeekKey"]
            ?? Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY")
            ?? "";
    }

    /// <summary>Get DeepSeek base URL: DB SystemSettings first, then config.</summary>
    private async Task<string> GetBaseUrl()
    {
        var setting = await _db.SystemSettings.FindAsync("AI:DeepSeekBaseUrl");
        if (setting is not null && !string.IsNullOrEmpty(setting.Value)) return setting.Value;
        return _config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
    }

    public WikiGeneratorOptions GetOptions() => _options;
    public void UpdateOptions(WikiGeneratorOptions opts) { _options = opts; var s = new WikiSettingsStore { Options = opts }; s.Save(); }

    // ════════════════════════════════════════
    //  Public API — 任务管理
    // ════════════════════════════════════════

    public async Task<WikiTask> SubmitGit(string url, string projectName, string targetFolder, int userId, string visibility = "public", string? model = null, string? customCatalogJson = null)
    {
        var task = new WikiTask { Type = "git", SourceUrl = url, ProjectName = projectName, TargetFolder = targetFolder, UserId = userId, Visibility = visibility, Model = model, CustomCatalogJson = customCatalogJson };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<WikiTask> SubmitZip(string zipPath, string projectName, string targetFolder, int userId, string visibility = "public", string? model = null, string? customCatalogJson = null)
    {
        var task = new WikiTask { Type = "zip", SourceUrl = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(zipPath)), ProjectName = projectName, TargetFolder = targetFolder, UserId = userId, Visibility = visibility, Model = model, CustomCatalogJson = customCatalogJson };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<WikiTask> SubmitTranslate(string url, string projectName, string targetFolder, int userId, string visibility = "public", string? model = null, string? customCatalogJson = null)
    {
        var task = new WikiTask { Type = "translate", SourceUrl = url, ProjectName = projectName, TargetFolder = targetFolder, UserId = userId, Visibility = visibility, Model = model, CustomCatalogJson = customCatalogJson };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<bool> UpdateVisibility(string id, string visibility)
    {
        var task = await _db.WikiTasks.FindAsync(id);
        if (task is null) return false;
        task.Visibility = visibility;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>缺失文档预览：不产生任何 AI 调用，供前端在动手前告知"会花多少"。</summary>
    public async Task<(int Total, List<string> Missing)?> GetMissingDocuments(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return null;
        PrepareFields(task);
        var leaves = SafeLeaves();
        return (leaves.Count, FindMissingDocuments(leaves, DocumentExists));
    }

    /// <summary>
    /// 只补齐缺失的文档。刻意不重跑整条管线：
    ///   1) 复用已存的目录 —— 省掉目录生成那一次 AI 调用
    ///   2) 只对缺失的目录项调用 AI —— 已有文档一个字都不重写
    ///   3) 不重复复审全项目
    /// 所以大仓库的补写成本只与「缺了几篇」成正比，与仓库规模无关。
    /// 源码工作区仍要重新准备（git 重新 clone / zip 重新解压），而这一步失败发生在任何 AI 调用之前，
    /// 不会白花钱。
    /// </summary>
    public async Task<WikiRetryResult> RetryMissingDocuments(string taskId, CancellationToken ct = default)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return new WikiRetryResult(false, 0, 0, "任务不存在");
        if (string.IsNullOrWhiteSpace(task.CatalogJson))
            return new WikiRetryResult(false, 0, 0, "该任务没有目录信息，无法只补齐文档；请在「Wiki 导入」页重新提交");

        PrepareFields(task);
        var missing = MissingDocuments();
        if (missing.Count == 0) return new WikiRetryResult(true, 0, 0, "没有缺失的文档，无需重新生成");

        try
        {
            _progress.Set(task.Id, "preparing", 0, missing.Count, $"补齐 {missing.Count} 篇缺失文档：准备工作区");
            // 复用上一次留下的工作区（task.WorkspacePath 里记着路径）——大仓库不必重新 clone / 重新上传 zip。
            // 只有它已被清理时才回退到重新准备；而重新准备失败发生在任何 AI 调用之前，不会白花钱。
            _workspacePath = ReusableWorkspace(task) ?? await PrepareWorkspace(task);
            task.WorkspacePath = _workspacePath;
            task.Status = "documents"; task.ErrorMessage = null; task.CompletedAt = null;
            await _db.SaveChangesAsync();

            var done = 0;
            _progress.Set(task.Id, "documents", 0, missing.Count, $"只补齐 {missing.Count} 篇缺失文档（已有文档不重跑）");
            using (var semaphore = new SemaphoreSlim(_options.ParallelCount))
            {
                var jobs = SafeLeaves().Where(i => missing.Contains(i.Path)).Select(async item =>
                {
                    await semaphore.WaitAsync(ct);
                    try
                    {
                        await GenerateDocumentVerified(item);
                        var finished = Interlocked.Increment(ref done);
                        _progress.Set(task.Id, "documents", finished, missing.Count, item.Title);
                    }
                    finally { semaphore.Release(); }
                });
                await Task.WhenAll(jobs);
            }

            var stillMissing = MissingDocuments();
            var written = missing.Count - stillMissing.Count;
            task.Status = "completed";
            task.CompletedAt = DateTime.UtcNow;
            task.ErrorMessage = stillMissing.Count == 0
                ? null
                : $"仍有 {stillMissing.Count} 篇文档未生成（{MissingDocumentsSummary(stillMissing)}），可稍后再试或检查 AI 配置。";
            _progress.Set(task.Id, "completed", written, missing.Count, task.ErrorMessage);
            await _db.SaveChangesAsync();
            _logger.LogInformation("Wiki task {TaskId} retry wrote {Written}/{Missing} missing documents", task.Id, written, missing.Count);
            return new WikiRetryResult(true, missing.Count, stillMissing.Count, stillMissing.Count == 0
                ? $"已补齐 {written} 篇文档"
                : $"补齐 {written}/{missing.Count} 篇，仍有 {stillMissing.Count} 篇未生成");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki task {TaskId} retry failed", taskId);
            task.Status = "failed";
            task.ErrorMessage = $"补齐文档失败：{ex.Message}";
            await _db.SaveChangesAsync();
            return new WikiRetryResult(false, missing.Count, missing.Count, task.ErrorMessage);
        }
    }

    /// <summary>
    /// 上一次生成留下的工作区是否还能直接用：目录存在且非空就复用。
    /// 大仓库重新 clone 又慢又费流量，而补写文档用的还是同一份源码。
    /// </summary>
    private string? ReusableWorkspace(WikiTask task)
    {
        var path = task.WorkspacePath;
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return null;
        if (!Directory.EnumerateFileSystemEntries(path).Any()) return null;
        // 内容已清空的目录（例如 review 阶段之后被清理过）不算可用
        _logger.LogInformation("Reusing existing workspace for {Project}: {Path}", task.ProjectName, path);
        return path;
    }

    /// <summary>把任务字段灌进当前会话状态（补写路径复用）。</summary>
    private void PrepareFields(WikiTask task)
    {
        _currentTaskId = task.Id;
        _projectName = task.ProjectName;
        _targetFolder = task.TargetFolder;
        _catalogJson = string.IsNullOrWhiteSpace(task.CatalogJson) ? "[]" : task.CatalogJson;
        _currentModel = task.Model ?? _options.ContentModel;
        _currentCatalogModel = task.Model ?? _options.CatalogModel;
        _customCatalogJson = task.CustomCatalogJson;
    }

    public async Task<bool> DeleteTask(string id, KnowledgeService knowledge)
    {
        var task = await _db.WikiTasks.FindAsync(id);
        if (task is null) return false;
        // Clean up knowledge base files
        try
        {
            var zhPath = Path.Combine(task.TargetFolder, task.ProjectName).Replace('\\', '/');
            knowledge.DeleteFile(zhPath);
            var enPath = Path.Combine(task.TargetFolder, $"{task.ProjectName}_EN").Replace('\\', '/');
            try { knowledge.DeleteFile(enPath); } catch { /* EN path may not exist */ }
        }
        catch { /* best effort cleanup */ }
        // Clean up workspace
        if (!string.IsNullOrEmpty(task.WorkspacePath) && Directory.Exists(task.WorkspacePath))
            try { Directory.Delete(task.WorkspacePath, true); } catch { }
        _db.WikiTasks.Remove(task);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<List<WikiTask>> GetTasks() => await _db.WikiTasks.OrderByDescending(t => t.CreatedAt).Take(20).ToListAsync();

    public async Task<WikiTask?> GetTask(string id) => await _db.WikiTasks.FindAsync(id);

    // ════════════════════════════════════════
    //  Processing Pipeline — 生成管线编排
    // ════════════════════════════════════════

    public async Task ProcessTask(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return;

        try
        {
            _currentTaskId = task.Id;
            _projectName = task.ProjectName;
            _targetFolder = task.TargetFolder;
            _processedFiles.Clear();
            // 任务级 model(覆盖全局 CatalogModel/ContentModel);用户自定义目录直接跳过 AI catalog 生成
            _currentModel = task.Model ?? _options.ContentModel;
            _currentCatalogModel = task.Model ?? _options.CatalogModel;
            _customCatalogJson = task.CustomCatalogJson;

            // Step 1: Prepare workspace
            task.Status = "preparing"; await _db.SaveChangesAsync();
            _progress.Set(task.Id, "preparing", 0, 0, "准备工作区");
            _workspacePath = await PrepareWorkspace(task);
            task.WorkspacePath = _workspacePath; await _db.SaveChangesAsync();

            // Step 1.5: Detect complexity and auto-adjust parameters
            var complexity = DetectProjectComplexity(_workspacePath);
            _complexityScore = complexity.Score;
            AutoAdjustParameters(complexity);
            _progress.Set(task.Id, "preparing", 0, 0, $"扫描到 {complexity.FileCount} 个文件 / 约 {complexity.LinesOfCode} 行");
            _logger.LogInformation("Wiki complexity: {Score}/5 ({FileCount} files, {DirCount} dirs, ~{Loc} LOC). model={Model}, timeout={Timeout}min",
                complexity.Score, complexity.FileCount, complexity.DirCount, complexity.LinesOfCode,
                _options.ContentModel, _options.DocumentGenerationTimeoutMinutes);

            // Step 2: Generate catalog
            task.Status = "catalog"; await _db.SaveChangesAsync();
            _progress.Set(task.Id, "catalog", 0, 0, "AI 正在规划目录结构");
            _catalogJson = await GenerateCatalog();
            task.CatalogJson = _catalogJson; await _db.SaveChangesAsync();

            // Step 3: Generate documents
            task.Status = "documents"; await _db.SaveChangesAsync();
            await GenerateAllDocuments();

            // 校验文档真的落盘了：AI 只回文本而不调用 write_doc 时不会抛异常，
            // 不校验就会出现「任务已完成但一篇文档都没有」——目录能点开、文档全 404。
            var total = LeafCount();
            var missing = MissingDocuments();
            var written = total - missing.Count;
            if (missing.Count > 0)
            {
                var sample = MissingDocumentsSummary(missing);
                if (written == 0)
                {
                    // 一篇都没写出来：基本是 AI 配置/额度/模型问题，不能让用户以为成功了
                    task.Status = "failed";
                    task.ErrorMessage = $"文档生成失败：{missing.Count} 篇全部未写入（{sample}）。请检查 AI 配置后重新提交。";
                    task.CompletedAt = DateTime.UtcNow;
                    _progress.Set(task.Id, "failed", 0, total, task.ErrorMessage);
                    _logger.LogError("Wiki task {TaskId} produced no documents. Missing: {Missing}", task.Id, sample);
                    await _db.SaveChangesAsync();
                    return;
                }
                // 部分缺失：已有文档仍可用，但必须让用户看见"不完整"
                task.ErrorMessage = $"有 {missing.Count} 篇文档未生成（{sample}），可在「Wiki 导入」页重新提交该任务补齐。";
                _logger.LogError("Wiki task {TaskId} missing {Count} documents. Missing: {Missing}", task.Id, missing.Count, sample);
            }

            // Step 4: Self-review — fix mermaid syntax, markdown errors, etc.
            task.Status = "reviewing"; await _db.SaveChangesAsync();
            await ReviewAllDocuments();

            // Done
            task.Status = "completed";
            task.CompletedAt = DateTime.UtcNow;
            _progress.Set(task.Id, "completed", written, total, task.ErrorMessage);
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki task {TaskId} failed", taskId);
            task.Status = "failed";
            task.ErrorMessage = ex.Message;
            var current = _progress.Get(task.Id);
            _progress.Set(task.Id, "failed", current?.Done ?? 0, current?.Total ?? 0, ex.Message);
            await _db.SaveChangesAsync();
        }
    }

    /// <summary>补齐缺失文档的结果（Missing=需要补的篇数，StillMissing=补完仍缺的）。</summary>
    public record WikiRetryResult(bool Ok, int Missing, int StillMissing, string Message);

    /// <summary>单个文档的状态：应存在的位置 + 是否缺失 + 有多少个历史版本可用来恢复。</summary>
    public record WikiDocStatus(string Path, string RelativeFile, bool Exists, int HistoryVersions);

    /// <summary>任务诊断：文档到底该存在哪、缺了哪些、哪些能零成本从 .history 恢复。</summary>
    public record WikiTaskDiagnostics(
        string TargetFolder, string ProjectName, string ProjectDir, string KbRoot,
        string? WorkspacePath, bool WorkspaceExists,
        IReadOnlyList<WikiDocStatus> Documents, IReadOnlyList<string> Missing,
        IReadOnlyList<string> RecoverableFromHistory);

    /// <summary>概览：文档应该存在哪个目录、缺了几篇、几篇能从历史版本恢复（纯文件检查，不花 AI）。</summary>
    public async Task<WikiTaskDiagnostics?> DiagnoseTask(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return null;
        PrepareFields(task);

        var docs = SafeLeaves().Select(item =>
        {
            var relative = RelativeDocPath(item);
            return new WikiDocStatus(
                item.Path, relative, _knowledge.FileExists(relative), _knowledge.HistoryVersions(relative).Count);
        }).ToList();

        var missing = docs.Where(d => !d.Exists).Select(d => d.Path).ToList();
        var recoverable = docs.Where(d => !d.Exists && d.HistoryVersions > 0).Select(d => d.Path).ToList();
        return new WikiTaskDiagnostics(
            task.TargetFolder, task.ProjectName, $"{task.TargetFolder}/{task.ProjectName}", _knowledge.BasePath,
            task.WorkspacePath,
            !string.IsNullOrWhiteSpace(task.WorkspacePath) && Directory.Exists(task.WorkspacePath),
            docs, missing, recoverable);
    }

    /// <summary>
    /// 零成本恢复：用知识库 .history 里的历史版本补回缺失文档（不调用 AI、不产生费用）。
    /// 适用于「文档曾被覆盖/清空，但历史备份还在」的情况；从未写成功过的文档不在历史里，只能重新生成。
    /// </summary>
    public async Task<WikiRetryResult> RestoreMissingFromHistory(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return new WikiRetryResult(false, 0, 0, "任务不存在");
        PrepareFields(task);

        var missing = MissingDocuments();
        if (missing.Count == 0) return new WikiRetryResult(true, 0, 0, "没有缺失的文档，无需恢复");

        var restored = 0;
        var noHistory = new List<string>();
        foreach (var item in SafeLeaves().Where(i => missing.Contains(i.Path)))
        {
            var relative = RelativeDocPath(item);
            if (_knowledge.RestoreFromHistory(relative) is not null) restored++;
            else noHistory.Add(item.Path);
        }

        var stillMissing = MissingDocuments();
        if (restored > 0)
        {
            task.Status = "completed";
            task.CompletedAt = DateTime.UtcNow;
            task.ErrorMessage = stillMissing.Count == 0
                ? null
                : $"仍有 {stillMissing.Count} 篇文档没有历史版本（{MissingDocumentsSummary(stillMissing)}），需要用 AI 补齐。";
            _progress.Set(task.Id, "completed", 0, 0, $"已从历史版本恢复 {restored} 篇文档");
            await _db.SaveChangesAsync();
        }

        _logger.LogInformation("Wiki task {TaskId} restore-from-history: restored={Restored}, stillMissing={Still}",
            task.Id, restored, stillMissing.Count);
        var message = restored == 0
            ? $"没有可恢复的历史版本（{MissingDocumentsSummary(noHistory)} 从未写入成功过），需要用「补齐缺失文档」重新生成"
            : stillMissing.Count == 0
                ? $"已从历史版本恢复 {restored} 篇文档（未调用 AI，无费用）"
                : $"已恢复 {restored} 篇；仍有 {stillMissing.Count} 篇需要 AI 补齐";
        return new WikiRetryResult(restored > 0, missing.Count, stillMissing.Count, message);
    }

    /// <summary>纯函数便于单测：把缺失文档列表压成可读摘要（最多列 5 个）。</summary>
    internal static string MissingDocumentsSummary(IReadOnlyList<string> missing)
    {
        var sample = string.Join("、", missing.Take(5));
        return missing.Count > 5 ? sample + " 等" : sample;
    }

    /// <summary>解析当前目录 JSON；失败返回空表，避免调用方到处 try/catch。</summary>
    private List<CatalogItem> ParseCatalog()
    {
        try { return JsonSerializer.Deserialize<List<CatalogItem>>(_catalogJson, JsonOpts) ?? []; }
        catch { return []; }
    }

    /// <summary>目录树叶节点数（= 要生成的文档数）。</summary>
    private int LeafCount() => FlattenCatalog(ParseCatalog()).Count(i => i.Children is null or { Count: 0 });
}

public class ToolDef
{
    public string Name { get; set; }
    public string Description { get; set; }
    public object Parameters { get; set; }
    public ToolDef(string name, string desc, object properties)
    {
        Name = name; Description = desc;
        var props = JsonSerializer.SerializeToElement(properties);
        var required = new List<string>();
        foreach (var p in props.EnumerateObject()) required.Add(p.Name);
        Parameters = new { type = "object", properties, required };
    }
}

public class CatalogItem
{
    public string Path { get; set; } = "";
    public string Title { get; set; } = "";
    public List<CatalogItem>? Children { get; set; }
}
