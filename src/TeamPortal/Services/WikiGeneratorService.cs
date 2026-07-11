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

    public WikiGeneratorOptions GetOptions() => _options;
    public void UpdateOptions(WikiGeneratorOptions opts) { _options = opts; var s = new WikiSettingsStore { Options = opts }; s.Save(); }

    // ════════════════════════════════════════
    //  Public API
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

    /// <summary>Translate all markdown files in a cloned repo to Chinese.</summary>
    public async Task ProcessTranslateTask(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return;

        try
        {
            _currentTaskId = task.Id;
            _projectName = task.ProjectName;
            _targetFolder = task.TargetFolder;

            task.Status = "preparing"; await _db.SaveChangesAsync();
            var baseDir = Path.Combine(Path.GetTempPath(), "teamportal-wiki", $"{task.Id}-{DateTime.UtcNow:yyyyMMddHHmmss}");
            Directory.CreateDirectory(baseDir);
            var cloneDir = Path.Combine(baseDir, "repo");

            // Clone the repo
            task.Status = "cloning"; await _db.SaveChangesAsync();
            var psi = new System.Diagnostics.ProcessStartInfo("git", $"clone --depth 1 {task.SourceUrl} {cloneDir}")
            { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            var proc = System.Diagnostics.Process.Start(psi)!;
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                var err = await proc.StandardError.ReadToEndAsync();
                throw new InvalidOperationException($"Git clone failed: {err[..Math.Min(200, err.Length)]}");
            }

            // Find all .md files
            var mdFiles = Directory.GetFiles(cloneDir, "*.md", SearchOption.AllDirectories)
                .Where(f => !f.Replace('\\', '/').Contains("/.git/"))
                .Select(f => new { FullPath = f, Relative = Path.GetRelativePath(cloneDir, f).Replace('\\', '/') })
                .ToList();

            task.Status = "translating"; await _db.SaveChangesAsync();
            var total = mdFiles.Count;
            var done = 0;
            var aiKey = _config["AiService:DeepSeekKey"] ?? "";
            var aiUrl = _config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
            if (string.IsNullOrEmpty(aiKey)) throw new InvalidOperationException("AI API key not configured");

            var catalog = new List<object>();

            foreach (var file in mdFiles)
            {
                try
                {
                    var content = await File.ReadAllTextAsync(file.FullPath);
                    if (string.IsNullOrWhiteSpace(content) || content.Length < 50) continue;

                    // Save original English version as mirror
                    var enPath = $"{_targetFolder}/{_projectName}_EN/{file.Relative}".Replace("//", "/");
                    _knowledge.WriteFile(enPath, content);

                    // Translate and save Chinese version
                    var translated = await TranslateText(content, aiKey, aiUrl, _http);
                    if (!string.IsNullOrWhiteSpace(translated))
                    {
                        var zhPath = $"{_targetFolder}/{_projectName}/{file.Relative}".Replace("//", "/");
                        _knowledge.WriteFile(zhPath, translated);
                    }

                    catalog.Add(new { path = file.Relative.Replace(".md", ""), title = Path.GetFileNameWithoutExtension(file.Relative) });
                    done++;
                    _logger.LogInformation("Translate [{Done}/{Total}]: {File}", done, total, file.Relative);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Translation failed for {File}", file.Relative);
                }
            }

            task.CatalogJson = System.Text.Json.JsonSerializer.Serialize(catalog);
            task.Status = done > 0 ? "completed" : "failed";
            task.ErrorMessage = done == 0 ? $"All {total} pages failed to translate" : null;
            task.CompletedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            _logger.LogInformation("Translation {Status}: {Done}/{Total} pages", task.Status, done, total);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Translation task {TaskId} failed", taskId);
            task.Status = "failed"; task.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();
        }
    }

    private static async Task<string?> TranslateText(string content, string apiKey, string baseUrl, HttpClient http)
    {
        var prompt = $@"将以下英文技术文档翻译为简体中文。要求：
1. 准确翻译技术术语，保持专业性
2. 保留 Markdown 格式、代码块、链接、图片引用不变
3. 中文表述流畅自然，符合技术文档风格
4. 如果有 YAML front matter（---包裹的内容），保留不变

原文：
{content[..Math.Min(content.Length, 8000)]}";

        var payload = new
        {
            model = "deepseek-v4-flash",
            messages = new[] { new { role = "user", content = prompt } },
            temperature = 0.1, max_tokens = 8192
        };
        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
        { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.Add("Authorization", $"Bearer {apiKey}");

        var resp = await http.SendAsync(req);
        if (!resp.IsSuccessStatusCode) return null;
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
    }

    public async Task<List<WikiTask>> GetTasks() => await _db.WikiTasks.OrderByDescending(t => t.CreatedAt).Take(20).ToListAsync();

    public async Task<WikiTask?> GetTask(string id) => await _db.WikiTasks.FindAsync(id);

    // ════════════════════════════════════════
    //  Processing Pipeline
    // ════════════════════════════════════════

    /// <summary>Project complexity score used to auto-tune generation parameters.</summary>
    private record ComplexityInfo(int Score, int FileCount, int DirCount, int LinesOfCode);

    /// <summary>
    /// Analyze workspace to determine project complexity (1-5 scale).
    /// Simple: <30 files, <5 dirs, <2000 LOC → score 1-2
    /// Moderate: 30-100 files, 5-15 dirs, 2000-10000 LOC → score 3
    /// Complex: >100 files, >15 dirs, >10000 LOC → score 4-5
    /// </summary>
    private static ComplexityInfo DetectProjectComplexity(string workspacePath)
    {
        var srcDir = Path.Combine(workspacePath, "repo");
        if (!Directory.Exists(srcDir)) return new ComplexityInfo(1, 0, 0, 0);

        var codeExts = new HashSet<string> { ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".vue", ".svelte", ".swift", ".kt", ".rb", ".php", ".css", ".scss", ".json", ".yaml", ".yml", ".xml", ".csproj", ".sln", ".toml" };
        var files = Directory.GetFiles(srcDir, "*.*", SearchOption.AllDirectories);
        var codeFiles = files.Where(f => codeExts.Contains(Path.GetExtension(f).ToLowerInvariant())).ToArray();
        var dirs = Directory.GetDirectories(srcDir, "*", SearchOption.AllDirectories).Length;

        int totalLines = 0;
        foreach (var f in codeFiles.Take(200)) // Sample first 200 files for speed
        {
            try { totalLines += File.ReadLines(f).Take(500).Count(); } catch { }
        }

        // Compute score
        int score;
        if (codeFiles.Length < 20 && dirs < 5 && totalLines < 1500) score = 1;
        else if (codeFiles.Length < 50 && dirs < 10 && totalLines < 5000) score = 2;
        else if (codeFiles.Length < 120 && dirs < 20 && totalLines < 15000) score = 3;
        else if (codeFiles.Length < 250 && totalLines < 50000) score = 4;
        else score = 5;

        return new ComplexityInfo(score, codeFiles.Length, dirs, totalLines);
    }

    /// <summary>
    /// Auto-adjust generation parameters based on project complexity score.
    /// Simple projects get fewer iterations, smaller tokens, Flash model to avoid over-documentation.
    /// Complex projects get Pro model and more iterations for thorough coverage.
    /// </summary>
    private void AutoAdjustParameters(ComplexityInfo c)
    {
        // Model selection based on complexity — simple projects use flash (cheaper/faster)
        var model = c.Score <= 2 ? "deepseek-v4-flash" : "deepseek-v4-pro";
        _options.ContentModel = model;
        _options.CatalogModel = model;

        // Directory depth: shallow for simple projects, unlimited for complex
        _options.DirectoryTreeMaxDepth = c.Score switch
        {
            1 => 2,
            2 => 3,
            _ => -1,
        };

        // Parallelism: fewer concurrent docs for simple, more for complex
        _options.ParallelCount = c.Score <= 2 ? 2 : c.Score >= 4 ? 5 : 3;

        // Timeout scales with complexity
        _options.DocumentGenerationTimeoutMinutes = c.Score switch
        {
            1 => 30,
            2 => 60,
            3 => 90,
            4 => 120,
            _ => 180,
        };

        // Thinking mode only for complex projects
        _options.ThinkingMode = c.Score >= 4 ? "thinking" : "non-thinking";
    }

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
            System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, extractDir, true);
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
        if (maxDepth >= 0 && depth > maxDepth) return; // -1 = unlimited
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
        var model = _options.ContentModel;

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = userMessage }
        };

        var iteration = 0;

        while (iteration < 50)
        {
            iteration++;
            var payload = new
            {
                model,
                messages,
                temperature = _options.Temperature,
                top_p = _options.TopP,
                tools = tools.Select(t => new
                {
                    type = "function",
                    function = new { name = t.Name, description = t.Description, parameters = t.Parameters }
                }).ToList(),
                tool_choice = "auto",
                max_tokens = _options.MaxOutputTokens,
                extra_body = new { thinking_mode = _options.ThinkingMode }
            };

            var json = JsonSerializer.Serialize(payload, JsonOpts);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
            {
                Content = content
            };
            req.Headers.Add("Authorization", $"Bearer {apiKey}");

            var resp = await _http.SendAsync(req);
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

        throw new InvalidOperationException($"AI agent timed out after {_options.DocumentGenerationTimeoutMinutes} minutes");
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
        var maxTopItems = _complexityScore <= 2 ? "1-4" : _complexityScore >= 4 ? "5-10" : "3-7";
        var maxDepth = _complexityScore <= 2 ? "2" : "3";
        var scopeHint = _complexityScore <= 2 ? "简单项目，目录结构简洁即可，不要过度拆分" : "覆盖项目所有核心模块";

        var systemPrompt = $@"你是一个资深代码架构分析师。你需要分析项目代码并生成 Wiki 文档目录。

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
[{{
  ""path"": ""getting-started"",
  ""title"": ""快速开始"",
  ""children"": [
    {{ ""path"": ""getting-started/installation"", ""title"": ""安装指南"" }}
  ]
}}]

## 规则
- {maxTopItems} 个顶层目录项
- 每项最多 {maxDepth} 层深度
- 使用中文标题
- {scopeHint}
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

        using var semaphore = new SemaphoreSlim(_options.ParallelCount);
        var tasks = leaves.Select(async item =>
        {
            await semaphore.WaitAsync();
            try { await GenerateDocument(item); }
            finally { semaphore.Release(); }
        });

        await Task.WhenAll(tasks);
    }

    /// <summary>Review and fix all generated documents — mermaid syntax, markdown issues, etc.</summary>
    private async Task ReviewAllDocuments()
    {
        List<CatalogItem> items;
        try { items = JsonSerializer.Deserialize<List<CatalogItem>>(_catalogJson, JsonOpts) ?? new(); }
        catch { return; }

        var leaves = FlattenCatalog(items).Where(i => i.Children is null or { Count: 0 }).ToList();
        _logger.LogInformation("Reviewing {Count} documents for {Project}", leaves.Count, _projectName);

        foreach (var item in leaves)
        {
            try
            {
                var kbPath = $"{_targetFolder}/{_projectName}/{item.Path}.md".Replace("//", "/");
                var content = _knowledge.GetContent(kbPath);
                if (string.IsNullOrWhiteSpace(content)) continue;

                var reviewPrompt = $@"你是技术文档审查专家。检查以下文档问题并修复：

## 检查清单
1. Mermaid 图表语法是否正确（节点文本中的 ()、[]、{{}} 是否用双引号包裹）
2. Markdown 格式是否正确（标题层级、代码块语言标注、链接有效性）
3. 中文表述是否通顺、是否有明显错误
4. 代码块是否标注了语言（```python, ```csharp 等）

## 要求
- **只修复问题，不要重写整个文档**
- 如果文档没有问题，返回原文
- Mermaid 节点文本中的 () [] {{}} 必须用双引号包裹，如 A[""text()""]

## 原始文档
{content}

请返回修复后的完整 Markdown 文档：";

                var system = "你是一个文档审查专家。只修复问题，不重写。直接返回修复后的 Markdown 文档。";
                var aiKey = _config["AiService:DeepSeekKey"] ?? "";
                var aiUrl = _config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";

                var payload = new
                {
                    model = "deepseek-v4-flash",
                    messages = new object[] {
                        new { role = "system", content = system },
                        new { role = "user", content = reviewPrompt }
                    },
                    temperature = 0.2,
                    max_tokens = 16384
                };

                var json = JsonSerializer.Serialize(payload, JsonOpts);
                var req = new HttpRequestMessage(HttpMethod.Post, $"{aiUrl}/v1/chat/completions")
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("Authorization", $"Bearer {aiKey}");

                var resp = await _http.SendAsync(req);
                if (!resp.IsSuccessStatusCode) continue;

                var body = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var reviewed = doc.RootElement.GetProperty("choices")[0]
                    .GetProperty("message").GetProperty("content").GetString();

                if (!string.IsNullOrWhiteSpace(reviewed) && reviewed.Trim() != content.Trim())
                {
                    _knowledge.WriteFile(kbPath, reviewed);
                    _logger.LogInformation("Doc reviewed & fixed: {Path}", kbPath);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Review failed for {Path}", item.Path);
            }
        }
    }

    /// <summary>Public entry for manual update — re-run review on a completed task.</summary>
    public async Task<bool> UpdateDocuments(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null || task.Status != "completed") return false;

        _currentTaskId = task.Id;
        _projectName = task.ProjectName;
        _targetFolder = task.TargetFolder;
        _catalogJson = task.CatalogJson;
        _complexityScore = 3; // moderate for review

        try
        {
            task.Status = "reviewing"; await _db.SaveChangesAsync();
            await ReviewAllDocuments();
            task.Status = "completed";
            task.ErrorMessage = null;
            await _db.SaveChangesAsync();
            _logger.LogInformation("Wiki task updated: {Project}", task.ProjectName);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki update failed: {Project}", task.ProjectName);
            task.Status = "completed"; // revert to completed
            task.ErrorMessage = $"Update failed: {ex.Message}";
            await _db.SaveChangesAsync();
            return false;
        }
    }

    private async Task GenerateDocument(CatalogItem item)
    {
        var docPath = $"{item.Path}";
        var docTitle = item.Title;

        var complexityHint = _complexityScore <= 2
            ? "\n\n## 本项目为简单项目\n- 文档应该简洁精炼，不要过度解释显而易见的代码\n- 每个要点 1-2 段即可，避免冗长的背景介绍\n- Mermaid 图可选（仅在确实有助于理解时才画）\n- 重点放在实际使用方法和调用示例上"
            : _complexityScore >= 4
            ? "\n\n## 本项目为复杂项目\n- 需要深入分析架构设计和模块间交互\n- 每个模块的职责、数据流、错误处理都应该覆盖\n- 需要详细的 Mermaid 图来辅助理解\n- 代码示例应涵盖主要的 API 和关键路径"
            : "";

        var systemPrompt = $@"你是一个资深技术文档撰写专家。基于项目源代码撰写 Wiki 文档。

## 可用工具
- list_files(path): 列出目录
- read_file(path): 读取文件内容
- search_code(pattern, path): 搜索代码
- write_doc(path, content): 写入文档（必须调用！）
{complexityHint}

## 文档要求
1. 标题用 H1 (# )，必须与指定标题一致
2. 包含架构概述、核心流程、关键代码片段
3. {(_complexityScore <= 2 ? "如果有助于理解，可以包含一个 Mermaid 图" : "至少包含一个 Mermaid 流程图或时序图")}（Mermaid 节点文本中的括号、方括号等特殊字符需要用双引号包裹，例如 A[""函数名()""] 这样写）
4. 所有信息必须基于实际代码
5. 写中文文档，但保持代码标识符原文
6. 代码示例加语言标注 ```python, ```csharp 等
7. **文件引用链接**: 引用源码时使用格式 [{{path}}](/wiki/{_currentTaskId}/blob/{{path}})，点击可查看源码
8. 最后必须调用 write_doc 写入文档";

        var userMessage = $@"请撰写文档: **{docTitle}**

## 项目信息
- 项目: {_projectName}
- 类型: {DetectProjectType()}
- 任务ID: {_currentTaskId}

## 文档路径
- 路径: {docPath}
- 标题: {docTitle}

## 文件引用格式
源码引用链接: `/wiki/{_currentTaskId}/blob/{{文件路径}}`
使用 Markdown 链接: `[查看源码](/wiki/{_currentTaskId}/blob/src/main.py)`

## 指示
1. 先用 list_files 和 search_code 找到相关文件
2. 用 read_file 阅读关键源文件
3. 基于代码撰写完整文档
4. **重要**: 在文档中提及源码文件时，使用文件引用链接格式
5. 用 write_doc(path: ""{docPath}"", content: <你的 Markdown 文档>) 写入

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
