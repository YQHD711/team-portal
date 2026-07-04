using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// AI-powered code-to-wiki generator using DeepSeek function calling.
/// AI Agent reads source code via tools, generates catalog + documents.
/// Inspired by OpenDeepWiki WikiGenerator.
/// </summary>
public class WikiGeneratorService
{
    private readonly AppDbContext _db;
    private readonly KnowledgeService _knowledge;
    private readonly IConfiguration _config;
    private readonly HttpClient _http;
    private readonly ILogger<WikiGeneratorService> _logger;
    private string _workspacePath = "";
    private string _projectName = "";
    private string _targetFolder = "";
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
    }

    // ════════════════════════════════════════
    //  Public API
    // ════════════════════════════════════════

    public async Task<WikiTask> SubmitGit(string url, string projectName, string targetFolder, int userId)
    {
        var task = new WikiTask { Type = "git", SourceUrl = url, ProjectName = projectName, TargetFolder = targetFolder, UserId = userId };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<WikiTask> SubmitZip(string zipPath, string projectName, string targetFolder, int userId)
    {
        var task = new WikiTask { Type = "zip", SourceUrl = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(zipPath)), ProjectName = projectName, TargetFolder = targetFolder, UserId = userId };
        _db.WikiTasks.Add(task); await _db.SaveChangesAsync(); return task;
    }

    public async Task<List<WikiTask>> GetTasks() => await _db.WikiTasks.OrderByDescending(t => t.CreatedAt).Take(20).ToListAsync();

    public async Task<WikiTask?> GetTask(string id) => await _db.WikiTasks.FindAsync(id);

    // ════════════════════════════════════════
    //  Processing Pipeline
    // ════════════════════════════════════════

    public async Task ProcessTask(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return;

        try
        {
            _projectName = task.ProjectName;
            _targetFolder = task.TargetFolder;
            _processedFiles.Clear();

            // Step 1: Prepare workspace
            task.Status = "preparing"; await _db.SaveChangesAsync();
            _workspacePath = await PrepareWorkspace(task);
            task.WorkspacePath = _workspacePath; await _db.SaveChangesAsync();

            // Step 2: Generate catalog
            task.Status = "catalog"; await _db.SaveChangesAsync();
            _catalogJson = await GenerateCatalog();
            task.CatalogJson = _catalogJson; await _db.SaveChangesAsync();

            // Step 3: Generate documents
            task.Status = "documents"; await _db.SaveChangesAsync();
            await GenerateAllDocuments();

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

    // ════════════════════════════════════════
    //  Workspace Preparation
    // ════════════════════════════════════════

    private async Task<string> PrepareWorkspace(WikiTask task)
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "teamportal-wiki", task.Id);
        Directory.CreateDirectory(baseDir);

        if (task.Type == "git")
        {
            var cloneDir = Path.Combine(baseDir, "repo");
            if (Directory.Exists(cloneDir)) Directory.Delete(cloneDir, true);

            var psi = new ProcessStartInfo("git", $"clone --depth 1 {task.SourceUrl} \"{cloneDir}\"")
            {
                RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
            };
            var proc = Process.Start(psi)!;
            var stdout = await proc.StandardOutput.ReadToEndAsync();
            var stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();

            if (proc.ExitCode != 0)
                throw new InvalidOperationException($"Git clone failed: {stderr}");

            return cloneDir;
        }
        else // zip
        {
            var zipPath = Encoding.UTF8.GetString(Convert.FromBase64String(task.SourceUrl.Replace("archive::", "")));
            if (!File.Exists(zipPath)) throw new FileNotFoundException("ZIP file not found", zipPath);

            var extractDir = Path.Combine(baseDir, "repo");
            System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, extractDir);
            return extractDir;
        }
    }

    // ════════════════════════════════════════
    //  Project Context
    // ════════════════════════════════════════

    private string DetectProjectType()
    {
        var root = _workspacePath;
        var types = new List<string>();
        if (Directory.GetFiles(root, "*.csproj", SearchOption.AllDirectories).Any() || Directory.GetFiles(root, "*.sln").Any()) types.Add("dotnet");
        if (File.Exists(Path.Combine(root, "package.json")))
        {
            var pkg = File.ReadAllText(Path.Combine(root, "package.json"));
            types.Add(pkg.Contains("\"next\"") || pkg.Contains("\"react\"") || pkg.Contains("\"vue\"") ? "frontend" : "nodejs");
        }
        if (Directory.GetFiles(root, "pom.xml").Any() || Directory.GetFiles(root, "build.gradle*").Any()) types.Add("java");
        if (File.Exists(Path.Combine(root, "go.mod"))) types.Add("go");
        if (File.Exists(Path.Combine(root, "requirements.txt")) || File.Exists(Path.Combine(root, "pyproject.toml")) || File.Exists(Path.Combine(root, "setup.py"))) types.Add("python");
        if (File.Exists(Path.Combine(root, "Cargo.toml"))) types.Add("rust");
        if (types.Count == 0) return "unknown";
        if (types.Count > 1) return "fullstack:" + string.Join("+", types);
        return types[0];
    }

    private string BuildDirectoryTree()
    {
        var sb = new StringBuilder();
        BuildTreeRecursive(_workspacePath, "", sb, 0, 3);
        return sb.ToString();
    }

    private void BuildTreeRecursive(string dir, string prefix, StringBuilder sb, int depth, int maxDepth)
    {
        if (depth > maxDepth) return;
        try
        {
            foreach (var subDir in Directory.GetDirectories(dir).OrderBy(Path.GetFileName))
            {
                var name = Path.GetFileName(subDir);
                if (name.StartsWith('.') || ExcludedDirs.Contains(name)) continue;
                sb.AppendLine($"{prefix}├── 📁 {name}");
                BuildTreeRecursive(subDir, prefix + "│   ", sb, depth + 1, maxDepth);
            }
            if (depth <= 1)
                foreach (var file in Directory.GetFiles(dir, "*.*").OrderBy(Path.GetFileName).Take(30))
                    if (!Path.GetFileName(file).StartsWith('.'))
                        sb.AppendLine($"{prefix}├── 📄 {Path.GetFileName(file)}");
        }
        catch { /* skip inaccessible */ }
    }

    private string ReadReadme()
    {
        foreach (var name in new[] { "README.md", "README.MD", "readme.md", "README" })
        {
            var path = Path.Combine(_workspacePath, name);
            if (File.Exists(path))
            {
                var text = File.ReadAllText(path);
                return text.Length > 10000 ? text[..10000] + "\n...(truncated)" : text;
            }
        }
        return "(No README found)";
    }

    private string IdentifyEntryPoints()
    {
        var entries = new List<string>();
        foreach (var pattern in new[] { "Program.cs", "Startup.cs", "main.py", "app.py", "main.go", "index.tsx", "index.ts", "App.tsx", "main.ts", "main.tsx" })
        {
            foreach (var f in Directory.GetFiles(_workspacePath, pattern, SearchOption.AllDirectories).Take(2))
            {
                var rel = Path.GetRelativePath(_workspacePath, f).Replace('\\', '/');
                if (!rel.Contains("node_modules") && !rel.Contains("bin/") && !rel.Contains("obj/"))
                    entries.Add(rel);
            }
        }
        return string.Join("\n", entries.Distinct().Take(10).Select(e => $"- {e}"));
    }

    // ════════════════════════════════════════
    //  AI Agent Core
    // ════════════════════════════════════════

    private async Task<string> CallDeepSeekWithTools(string systemPrompt, string userMessage, List<ToolDef> tools, string taskDesc)
    {
        var apiKey = _config["AiService:DeepSeekKey"] ?? Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY") ?? "";
        var baseUrl = _config["AiService:DeepSeekBaseUrl"] ?? "https://api.deepseek.com";
        var model = "deepseek-chat";

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = userMessage }
        };

        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        var maxIterations = 30;
        var iteration = 0;

        while (iteration++ < maxIterations)
        {
            var payload = new
            {
                model,
                messages,
                tools = tools.Select(t => new
                {
                    type = "function",
                    function = new { name = t.Name, description = t.Description, parameters = t.Parameters }
                }).ToList(),
                tool_choice = "auto",
                max_tokens = 4096
            };

            var json = JsonSerializer.Serialize(payload, JsonOpts);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
            {
                Content = content
            };
            req.Headers.Add("Authorization", $"Bearer {apiKey}");

            var resp = await http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();

            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"DeepSeek API error: {resp.StatusCode} - {body[..Math.Min(body.Length, 200)]}");

            using var doc = JsonDocument.Parse(body);
            var choice = doc.RootElement.GetProperty("choices")[0];
            var msg = choice.GetProperty("message");

            // Add assistant message to conversation
            var assistantMsg = new Dictionary<string, object> { ["role"] = "assistant" };

            // Check for tool calls
            if (msg.TryGetProperty("tool_calls", out var toolCalls) && toolCalls.GetArrayLength() > 0)
            {
                var toolCallList = new List<object>();
                var toolResults = new List<object>();

                foreach (var tc in toolCalls.EnumerateArray())
                {
                    var func = tc.GetProperty("function");
                    var funcName = func.GetProperty("name").GetString()!;
                    var funcArgs = func.GetProperty("arguments").GetString()!;
                    var callId = tc.GetProperty("id").GetString()!;

                    _logger.LogInformation("AI Tool call: {Func}({Args})", funcName, funcArgs[..Math.Min(funcArgs.Length, 100)]);

                    var result = await ExecuteTool(funcName, funcArgs);

                    toolCallList.Add(new
                    {
                        id = callId, type = "function",
                        function = new { name = funcName, arguments = funcArgs }
                    });

                    toolResults.Add(new
                    {
                        role = "tool", tool_call_id = callId,
                        content = result[..Math.Min(result.Length, 8000)] // truncate very long results
                    });
                }

                assistantMsg["tool_calls"] = toolCallList;
                messages.Add(assistantMsg);
                messages.AddRange(toolResults);
            }
            else
            {
                // Final text response
                var text = msg.GetProperty("content").GetString() ?? "";
                _logger.LogInformation("AI generation complete ({Task}), {Len} chars", taskDesc, text.Length);
                return text;
            }
        }

        throw new InvalidOperationException($"AI agent exceeded max iterations ({maxIterations})");
    }

    // ════════════════════════════════════════
    //  Tools
    // ════════════════════════════════════════

    private async Task<string> ExecuteTool(string name, string argsJson)
    {
        try
        {
            using var args = JsonDocument.Parse(argsJson);
            var root = args.RootElement;

            return name switch
            {
                "list_files" => ToolListFiles(GetArg(root, "path")),
                "read_file" => ToolReadFile(GetArg(root, "path")),
                "search_code" => ToolSearchCode(GetArg(root, "pattern"), GetArg(root, "path") ?? ""),
                "write_catalog" => ToolWriteCatalog(GetArg(root, "json")),
                "write_doc" => ToolWriteDoc(GetArg(root, "path"), GetArg(root, "content")),
                _ => $"{{\"error\": \"Unknown tool: {name}\"}}"
            };
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private static string GetArg(JsonElement root, string key) => root.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";

    private string ToolListFiles(string path)
    {
        var dir = ResolvePath(path);
        if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found: {path}\"}}";
        var items = new List<string>();
        foreach (var d in Directory.GetDirectories(dir).Select(Path.GetFileName).Where(n => !n.StartsWith('.') && !ExcludedDirs.Contains(n!)).OrderBy(n => n))
            items.Add($"📁 {d}/");
        foreach (var f in Directory.GetFiles(dir).Select(Path.GetFileName).Where(n => !n!.StartsWith('.')).OrderBy(n => n).Take(50))
            items.Add($"📄 {f}");
        return JsonSerializer.Serialize(new { path, items });
    }

    private string ToolReadFile(string path)
    {
        var fullPath = ResolvePath(path);
        if (!File.Exists(fullPath)) return $"{{\"error\": \"File not found: {path}\"}}";
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();
        if (ext is ".dll" or ".exe" or ".so" or ".bin" or ".zip" or ".png" or ".jpg" or ".ico" or ".pdf")
            return $"{{\"error\": \"Binary file, cannot read: {path}\"}}";
        var text = File.ReadAllText(fullPath);
        if (text.Length > 15000) text = text[..15000] + $"\n\n...(truncated, total {text.Length} chars)";
        _processedFiles.Add(path);
        return text;
    }

    private string ToolSearchCode(string pattern, string path)
    {
        try
        {
            var dir = string.IsNullOrEmpty(path) ? _workspacePath : ResolvePath(path);
            if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found\"}}";
            var results = new List<string>();
            var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
            foreach (var file in Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories).Take(200))
            {
                var name = Path.GetFileName(file);
                if (name.StartsWith('.') || file.Contains("node_modules") || file.Contains(".git")) continue;
                try
                {
                    var lines = File.ReadAllLines(file);
                    for (int i = 0; i < lines.Length; i++)
                        if (regex.IsMatch(lines[i]))
                            results.Add($"{Path.GetRelativePath(_workspacePath, file).Replace('\\', '/')}:{i + 1}: {lines[i].Trim()[..Math.Min(lines[i].Trim().Length, 120)]}");
                    if (results.Count > 50) break;
                }
                catch { /* skip binary */ }
            }
            return JsonSerializer.Serialize(new { pattern, matches = results.Take(50).ToList(), total = results.Count });
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private string ToolWriteCatalog(string json) { _catalogJson = json; return "{\"success\": true, \"message\": \"Catalog saved\"}"; }

    private string ToolWriteDoc(string path, string content)
    {
        var relativePath = $"{_targetFolder}/{_projectName}/{path}.md".Replace("//", "/");
        _knowledge.WriteFile(relativePath, content);
        _logger.LogInformation("Doc written: {Path}", relativePath);
        return $"{{\"success\": true, \"path\": \"{relativePath}\"}}";
    }

    private string ResolvePath(string relativePath)
    {
        var full = Path.GetFullPath(Path.Combine(_workspacePath, relativePath));
        var norm = Path.GetFullPath(_workspacePath);
        return full.StartsWith(norm) ? full : throw new InvalidOperationException("Path traversal denied");
    }

    // ════════════════════════════════════════
    //  Catalog Generation
    // ════════════════════════════════════════

    private async Task<string> GenerateCatalog()
    {
        var systemPrompt = @"你是一个资深代码架构分析师。你需要分析项目代码并生成 Wiki 文档目录。

## 可用工具
- list_files(path): 列出目录内容
- read_file(path): 读取文件内容
- search_code(pattern, path): 搜索代码
- write_catalog(json): 写入目录结构（必须调用！）

## 工作流程
1. 用 list_files 浏览项目结构
2. 用 read_file 阅读入口文件和关键配置
3. 用 search_code 了解核心模块
4. 用 write_catalog 输出 JSON 目录

## 目录输出格式
[{
  ""path"": ""getting-started"",
  ""title"": ""快速开始"",
  ""children"": [
    { ""path"": ""getting-started/installation"", ""title"": ""安装指南"" }
  ]
}]

## 规则
- 3-8 个顶层目录项
- 每项最多 3 层深度
- 使用中文标题
- 必须调用 write_catalog 完成";

        var userMessage = $@"分析项目并生成 Wiki 目录。

项目名: {_projectName}
类型: {DetectProjectType()}

目录结构:
{BuildDirectoryTree()}

README:
{ReadReadme()}

入口文件:
{IdentifyEntryPoints()}

请开始分析并生成目录。";

        var tools = new List<ToolDef>
        {
            new("list_files", "List directory contents. Path is relative to project root.", new { path = new { type = "string", description = "Directory path, empty for root" } }),
            new("read_file", "Read file content. Returns text of the file.", new { path = new { type = "string", description = "Relative file path" } }),
            new("search_code", "Search code with regex pattern.", new { pattern = new { type = "string", description = "Regex pattern to search" }, path = new { type = "string", description = "Optional subdirectory path" } }),
            new("write_catalog", "Save the catalog JSON. MUST call this to complete.", new { json = new { type = "string", description = "Catalog JSON array" } }),
        };

        await CallDeepSeekWithTools(systemPrompt, userMessage, tools, "Catalog");
        return _catalogJson;
    }

    // ════════════════════════════════════════
    //  Document Generation
    // ════════════════════════════════════════

    private async Task GenerateAllDocuments()
    {
        List<CatalogItem> items;
        try { items = JsonSerializer.Deserialize<List<CatalogItem>>(_catalogJson, JsonOpts) ?? new(); }
        catch { items = new(); }

        var leaves = FlattenCatalog(items).Where(i => i.Children is null or { Count: 0 }).ToList();
        _logger.LogInformation("Generating {Count} documents for {Project}", leaves.Count, _projectName);

        using var semaphore = new SemaphoreSlim(3);
        var tasks = leaves.Select(async item =>
        {
            await semaphore.WaitAsync();
            try { await GenerateDocument(item); }
            finally { semaphore.Release(); }
        });

        await Task.WhenAll(tasks);
    }

    private async Task GenerateDocument(CatalogItem item)
    {
        var docPath = $"{item.Path}";
        var docTitle = item.Title;

        var systemPrompt = @"你是一个资深技术文档撰写专家。基于项目源代码撰写详细的 Wiki 文档。

## 可用工具
- list_files(path): 列出目录
- read_file(path): 读取文件内容
- search_code(pattern, path): 搜索代码
- write_doc(path, content): 写入文档（必须调用！）

## 文档要求
1. 标题用 H1 (# )，必须与指定标题一致
2. 包含架构概述、核心流程、关键代码片段
3. 至少包含一个 Mermaid 流程图或时序图
4. 所有信息必须基于实际代码
5. 写中文文档，但保持代码标识符原文
6. 代码示例加语言标注 ```python, ```csharp 等
7. 最后必须调用 write_doc 写入文档";

        var userMessage = $@"请撰写文档: **{docTitle}**

## 项目信息
- 项目: {_projectName}
- 类型: {DetectProjectType()}

## 文档路径
- 路径: {docPath}
- 标题: {docTitle}

## 指示
1. 先用 list_files 和 search_code 找到相关文件
2. 用 read_file 阅读关键源文件
3. 基于代码撰写完整文档
4. 用 write_doc(path: ""{docPath}"", content: <你的 Markdown 文档>) 写入

请开始撰写。";

        var tools = new List<ToolDef>
        {
            new("list_files", "List directory contents.", new { path = new { type = "string", description = "Directory path" } }),
            new("read_file", "Read file content.", new { path = new { type = "string", description = "File path" } }),
            new("search_code", "Search code.", new { pattern = new { type = "string" }, path = new { type = "string" } }),
            new("write_doc", "Write document. MUST call this.", new { path = new { type = "string", description = "Document path (without .md)" }, content = new { type = "string", description = "Full Markdown content" } }),
        };

        await CallDeepSeekWithTools(systemPrompt, userMessage, tools, $"Doc:{docTitle}");
    }

    private static List<CatalogItem> FlattenCatalog(List<CatalogItem> items)
    {
        var result = new List<CatalogItem>();
        foreach (var item in items) { result.Add(item); if (item.Children?.Count > 0) result.AddRange(FlattenCatalog(item.Children)); }
        return result;
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
