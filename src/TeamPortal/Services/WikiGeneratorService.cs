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
    private WikiGeneratorOptions _options;
    private string _workspacePath = "";
    private string _projectName = "";
    private string _targetFolder = "";
    private int _complexityScore = 3;
    private string _currentTaskId = "";
    private readonly List<string> _processedFiles = new();
    private string _catalogJson = "[]";

    private static readonly HashSet<string> ExcludedDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "node_modules", "bin", "obj", "dist", "build", ".git", ".svn", ".hg",
        ".idea", ".vscode", ".vs", "__pycache__", ".cache", "coverage",
        "packages", "vendor", ".next", ".nuxt", "target", "out", ".output"
    };

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public WikiGeneratorService(AppDbContext db, KnowledgeService knowledge, IConfiguration config, HttpClient http, ILogger<WikiGeneratorService> logger)
    {
        _db = db; _knowledge = knowledge; _config = config; _http = http; _logger = logger;
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

    public async Task<WikiTask> SubmitGit(string url, string projectName, string targetFolder, int userId, string visibility = "public")
    {
        var task = new WikiTask { Type = "git", SourceUrl = url, ProjectName = projectName, TargetFolder = targetFolder, UserId = userId, Visibility = visibility };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<WikiTask> SubmitZip(string zipPath, string projectName, string targetFolder, int userId, string visibility = "public")
    {
        var task = new WikiTask { Type = "zip", SourceUrl = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(zipPath)), ProjectName = projectName, TargetFolder = targetFolder, UserId = userId, Visibility = visibility };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<WikiTask> SubmitTranslate(string url, string projectName, string targetFolder, int userId, string visibility = "public")
    {
        var task = new WikiTask { Type = "translate", SourceUrl = url, ProjectName = projectName, TargetFolder = targetFolder, UserId = userId, Visibility = visibility };
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

            // Step 1: Prepare workspace
            task.Status = "preparing"; await _db.SaveChangesAsync();
            _workspacePath = await PrepareWorkspace(task);
            task.WorkspacePath = _workspacePath; await _db.SaveChangesAsync();

            // Step 1.5: Detect complexity and auto-adjust parameters
            var complexity = DetectProjectComplexity(_workspacePath);
            _complexityScore = complexity.Score;
            AutoAdjustParameters(complexity);
            _logger.LogInformation("Wiki complexity: {Score}/5 ({FileCount} files, {DirCount} dirs, ~{Loc} LOC). model={Model}, timeout={Timeout}min",
                complexity.Score, complexity.FileCount, complexity.DirCount, complexity.LinesOfCode,
                _options.ContentModel, _options.DocumentGenerationTimeoutMinutes);

            // Step 2: Generate catalog
            task.Status = "catalog"; await _db.SaveChangesAsync();
            _catalogJson = await GenerateCatalog();
            task.CatalogJson = _catalogJson; await _db.SaveChangesAsync();

            // Step 3: Generate documents
            task.Status = "documents"; await _db.SaveChangesAsync();
            await GenerateAllDocuments();

            // Step 4: Self-review — fix mermaid syntax, markdown errors, etc.
            task.Status = "reviewing"; await _db.SaveChangesAsync();
            await ReviewAllDocuments();

            // Done
            task.Status = "completed";
            task.CompletedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki task {TaskId} failed", taskId);
            task.Status = "failed";
            task.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();
        }
    }
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
