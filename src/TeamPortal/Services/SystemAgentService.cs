using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// AI System Administrator — self-diagnosis, team analytics, code improvement proposals.
/// Uses DeepSeek function calling to analyze the system and make recommendations.
/// All write operations require admin approval via CodeProposal workflow.
/// </summary>
public class SystemAgentService
{
    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly string _projectRoot;
    private readonly List<string> _readFiles = new();

    public SystemAgentService(HttpClient http, IConfiguration config, AppDbContext db, LogService log)
    {
        _http = http;
        _db = db;
        _log = log;
        _apiKey = config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        _baseUrl = config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
        _projectRoot = Path.Combine(Directory.GetCurrentDirectory(), "..", "..");
    }

    /// <summary>
    /// Main entry: runs an AI agent session with tools to analyze the system.
    /// </summary>
    public async Task<string> RunAgent(string task, string userName)
    {
        if (string.IsNullOrEmpty(_apiKey)) return "❌ AI 密钥未配置";

        var systemPrompt = """
            你是"雏鹰之翼"航模队系统的AI管理员。你有能力分析系统状态、诊断问题、提出改进建议。

            ## 可用工具
            - get_system_stats(): 获取系统统计数据
            - read_logs(hours): 读取最近N小时的系统日志
            - read_code_file(path): 读取项目源代码文件（路径相对于项目根目录）
            - search_code(pattern): 在代码库中搜索模式
            - propose_improvement(title, description, filePath, suggestedCode): 创建代码改进提案（需管理员审批）
            - list_proposals(): 列出所有待处理提案

            ## 工作原则
            1. 先收集信息，再做出判断
            2. 分析要基于实际数据，不要凭空猜测
            3. 发现问题时给出具体的改进建议
            4. 涉及代码修改必须创建提案等待审批
            5. 回复使用中文，简洁专业
            """;

        var tools = new List<ToolDef>
        {
            new("get_system_stats", "Get system statistics (users, inventory, logs count, DB size)", new {}),
            new("read_logs", "Read recent system logs", new { hours = new { type = "integer", description = "Hours to look back (default 24)" } }),
            new("read_code_file", "Read a source code file from the project", new { path = new { type = "string", description = "Relative path from project root" } }),
            new("search_code", "Search for pattern in codebase", new { pattern = new { type = "string", description = "Search pattern" } }),
            new("propose_improvement", "Create a code improvement proposal for admin review", new { title = new { type = "string" }, description = new { type = "string" }, filePath = new { type = "string" }, suggestedCode = new { type = "string" } }),
            new("list_proposals", "List all pending improvement proposals", new {}),
        };

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = task }
        };

        var iteration = 0;
        while (iteration++ < 25)
        {
            var payload = new
            {
                model = "deepseek-v4-pro",
                messages,
                temperature = 0.7,
                top_p = 1.0,
                max_tokens = 4096,
                tools = tools.Select(t => new { type = "function", function = new { name = t.Name, description = t.Description, parameters = t.Parameters ?? new { type = "object", properties = new { } } } }).ToList(),
                tool_choice = "auto",
                extra_body = new { thinking_mode = "thinking" }
            };

            var json = JsonSerializer.Serialize(payload);
            var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/v1/chat/completions")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.Add("Authorization", $"Bearer {_apiKey}");

            var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            var choice = doc.RootElement.GetProperty("choices")[0];
            var msg = choice.GetProperty("message");

            if (msg.TryGetProperty("tool_calls", out var calls) && calls.GetArrayLength() > 0)
            {
                var toolMsgs = new List<object>();
                foreach (var tc in calls.EnumerateArray())
                {
                    var fn = tc.GetProperty("function");
                    var name = fn.GetProperty("name").GetString()!;
                    var args = fn.GetProperty("arguments").GetString()!;
                    var callId = tc.GetProperty("id").GetString()!;

                    var result = await ExecuteTool(name, args, userName);
                    toolMsgs.Add(new { role = "assistant", tool_calls = new[] { new { id = callId, type = "function", function = new { name, arguments = args } } } });
                    toolMsgs.Add(new { role = "tool", tool_call_id = callId, content = result[..Math.Min(result.Length, 4000)] });
                }
                messages.AddRange(toolMsgs);
            }
            else
            {
                return msg.GetProperty("content").GetString() ?? "无响应";
            }
        }

        return "分析超时，请重新尝试";
    }

    private async Task<string> ExecuteTool(string name, string args, string userName)
    {
        try
        {
            using var a = JsonDocument.Parse(args);
            var r = a.RootElement;

            return name switch
            {
                "get_system_stats" => await GetSystemStats(),
                "read_logs" => await ReadLogs(r.TryGetProperty("hours", out var h) ? h.GetInt32() : 24),
                "read_code_file" => ReadCodeFile(r.GetProperty("path").GetString()!),
                "search_code" => SearchCode(r.GetProperty("pattern").GetString()!),
                "propose_improvement" => CreateProposal(r, userName),
                "list_proposals" => await ListProposals(),
                _ => $"{{\"error\": \"Unknown tool: {name}\"}}"
            };
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private async Task<string> GetSystemStats()
    {
        var users = await _db.Users.CountAsync();
        var parts = await _db.InventoryItems.CountAsync();
        var totalQty = await _db.InventoryItems.SumAsync(i => i.Quantity);
        var depts = await _db.Departments.CountAsync();
        var logs = await _db.SystemLogs.CountAsync();
        var errors = await _db.SystemLogs.CountAsync(l => l.Level == "error");
        var wiki = await _db.WikiTasks.CountAsync(t => t.Status == "completed");
        var dbPath = Path.Combine(Directory.GetCurrentDirectory(), "data", "teamportal.db");
        var dbSize = File.Exists(dbPath) ? new FileInfo(dbPath).Length : 0;

        return JsonSerializer.Serialize(new { users, parts, totalQty, depts, totalLogs = logs, errors24h = errors, completedWikiProjects = wiki, dbSizeKB = dbSize / 1024 });
    }

    private async Task<string> ReadLogs(int hours)
    {
        var since = DateTime.UtcNow.AddHours(-hours);
        var logs = await _db.SystemLogs.Where(l => l.CreatedAt >= since).OrderByDescending(l => l.Id).Take(100).ToListAsync();
        return JsonSerializer.Serialize(logs.Select(l => new { l.Level, l.Category, l.Message, l.UserName, l.CreatedAt }));
    }

    private string ReadCodeFile(string path)
    {
        var full = Path.GetFullPath(Path.Combine(_projectRoot, path));
        if (!full.StartsWith(_projectRoot)) return $"{{\"error\": \"Access denied\"}}";
        if (!File.Exists(full)) return $"{{\"error\": \"File not found: {path}\"}}";
        var content = File.ReadAllText(full);
        _readFiles.Add(path);
        return content.Length > 20000 ? content[..20000] + "\n...(truncated)" : content;
    }

    private string SearchCode(string pattern)
    {
        try
        {
            var results = new List<string>();
            var regex = new System.Text.RegularExpressions.Regex(pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            foreach (var file in Directory.GetFiles(_projectRoot, "*.cs", SearchOption.AllDirectories).Take(100))
            {
                if (file.Contains("\\bin\\") || file.Contains("\\obj\\")) continue;
                var lines = File.ReadAllLines(file);
                for (int i = 0; i < lines.Length; i++)
                    if (regex.IsMatch(lines[i]))
                        results.Add($"{Path.GetRelativePath(_projectRoot, file).Replace('\\', '/')}:{i + 1}: {lines[i].Trim()[..Math.Min(120, lines[i].Trim().Length)]}");
                if (results.Count > 30) break;
            }
            return JsonSerializer.Serialize(new { pattern, count = results.Count, results = results.Take(30) });
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private string CreateProposal(JsonElement r, string user)
    {
        var proposal = new CodeProposal
        {
            Title = r.GetProperty("title").GetString()!,
            Description = r.GetProperty("description").GetString()!,
            FilePath = r.GetProperty("filePath").GetString()!,
            SuggestedCode = r.GetProperty("suggestedCode").GetString()!,
            CreatedBy = user
        };
        _db.CodeProposals.Add(proposal);
        _db.SaveChanges();
        _log.Info("admin", $"AI proposal created: {proposal.Title}");
        return $"{{\"success\": true, \"id\": \"{proposal.Id}\", \"message\": \"提案已创建，等待管理员审批\"}}";
    }

    private async Task<string> ListProposals()
    {
        var proposals = await _db.CodeProposals.Where(p => p.Status == "pending").OrderByDescending(p => p.CreatedAt).ToListAsync();
        return JsonSerializer.Serialize(proposals.Select(p => new { p.Id, p.Title, p.Description, p.FilePath, p.Status, p.CreatedAt }));
    }
}
