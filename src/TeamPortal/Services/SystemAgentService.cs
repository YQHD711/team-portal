using System.Text;
using System.Text.Json;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// AI System Administrator — self-diagnosis, team analytics, code improvement proposals.
/// Uses DeepSeek function calling to analyze the system and make recommendations.
/// All write operations require admin approval via CodeProposal workflow.
/// </summary>
/// <remarks>
/// 主类部分：字段、构造函数、RunAgent 主循环（DeepSeek function calling + 会话记忆）。
/// 其余职责拆分为 partial：Tools（工具实现）、Analysis（代码分析）、Proposals（提案管理）。
/// </remarks>
public partial class SystemAgentService
{
    private readonly HttpClient _http;
    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly IConfiguration _config;
    private readonly string _projectRoot;
    private readonly List<string> _readFiles = new();

    public SystemAgentService(HttpClient http, IConfiguration config, AppDbContext db, LogService log, SettingsService settings)
    {
        _http = http;
        _db = db;
        _log = log;
        _settings = settings;
        _config = config;
        _projectRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", ".."));
    }

    /// <summary>
    /// Main entry: runs an AI agent session with tools + conversation memory.
    /// </summary>
    public async Task<string> RunAgent(string task, string userName, List<(string role, string content)>? history = null)
    {
        var apiKey = await _settings.Get("AI:DeepSeekKey");
        if (string.IsNullOrEmpty(apiKey)) apiKey = _config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        if (string.IsNullOrEmpty(apiKey)) return "❌ AI 密钥未配置";

        var systemPrompt = """
            # 角色
            你是"雏鹰之翼"航模队系统的AI管理员。你的任务是分析系统、诊断问题、编写**可直接编译运行**的代码改进提案。

            # 工具
            - get_system_stats() — 系统统计
            - read_logs(hours) — 读系统日志
            - read_file(path) — 读任意文件（改文件前必调）
            - analyze_code(query) — 核心工具：查类名返回所有公开方法签名，查方法名返回完整实现，查关键词返回上下文。写代码前用它确认API！
            - read_db_schema(entityName) — 数据库模型字段定义（写数据库代码前必调）
            - list_files(subdir) — 列目录
            - propose_improvement(title, description, filePath, suggestedCode) — 创建提案
            - list_proposals() — 列提案

            # 代码修改铁律（违反任何一条的提案会被直接拒绝）

            ## 1. 写代码前必须调研
            - 改哪个文件 → 先 read_file 完整读它
            - 调用其他类的方法 → 先 analyze_code("类名") 查公开方法签名，不要编造方法名
            - 涉及数据库 → 先 read_db_schema("模型名") 查字段定义
            - 不确定项目结构 → list_files 浏览目录

            ## 2. 只做增量修改，绝不替换整个文件
            suggestedCode 必须是**完整的、可直接替换原文件的新文件内容**。
            你不应该在 suggestedCode 里只写"在这里插入..."这样的片段——
            你必须写出修改后的**完整文件内容**，确保它替换原文件后能编译通过。
            但是，只修改你真正需要改的部分，保持其他代码不变。

            ## 3. 保持文件结构完整
            - C# 文件必须保留所有 using 声明、namespace、class 定义
            - 不要在类外面写代码（Program.cs 除外）
            - 不要删除已有的方法、字段、属性
            - 不要修改与本提案无关的代码

            ## 4. 遵循项目代码规范
            - C# 4空格缩进，TS/JSON 2空格
            - 单文件不超过200行
            - Minimal API：一个端点一个文件
            - Services 不依赖 HTTP 上下文
            - 用 IConfiguration 读配置，不硬编码
            - 用 LogService 记录日志，不 Console.WriteLine

            ## 5. 写 proposal 的检查清单（逐条确认！）
            ☐ 目标文件已通过 read_file 完整读取
            ☐ 所有调用的外部方法已通过 analyze_code 确认签名正确
            ☐ 所有数据库字段已通过 read_db_schema 确认存在
            ☐ suggestedCode 是完整文件内容（不是diff/片段）
            ☐ using 声明完整，class 结构完整
            ☐ 没有使用不存在的方法/属性（如 CreateNotification 不存在，应该用 Notify）

            # 回复规范
            - 先给出简洁结论
            - 用列表分点展开
            - 发现 bug 先分析根因再提修改方案
            - 创建提案后说明改了哪个文件、为什么改、改了哪里
            - 每次只提 1-3 个紧密相关的提案，不要一口气提几十个
            """;

        var tools = new List<ToolDef>
        {
            new("get_system_stats", "Get system statistics (users, inventory count, DB size)", new {}),
            new("read_logs", "Read system logs", new { hours = new { type = "integer", description = "Hours back (default 24)" } }),
            new("read_file", "Read a file. Returns COMPLETE content. ALWAYS call before modifying a file.", new { path = new { type = "string", description = "Relative path, e.g. src/TeamPortal/Services/NotificationService.cs" } }),
            new("analyze_code", "ESSENTIAL: Look up class/method signatures before writing code that calls them. For a class name, returns ALL public methods with parameters. For a method name, returns full implementation. For keywords, returns matching code with context.", new { query = new { type = "string", description = "Class name (e.g. NotificationService), method name, or keyword" } }),
            new("read_db_schema", "Read database model field definitions — names, types, constraints", new { entityName = new { type = "string", description = "Model name: User, InventoryItem, Department, etc. Or 'all'" } }),
            new("list_files", "List directory contents", new { subdir = new { type = "string", description = "Subdirectory path or empty for root" } }),
            new("propose_improvement", "Create a code proposal. suggestedCode = COMPLETE file after changes.", new {
                title = new { type = "string" },
                description = new { type = "string" },
                filePath = new { type = "string" },
                suggestedCode = new { type = "string", description = "The ENTIRE file content after your modifications. Not a snippet, not a diff." }
            }),
            new("list_proposals", "List all proposals", new {}),
        };

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
        };

        // Add conversation history
        if (history != null && history.Count > 0)
        {
            foreach (var (role, content) in history)
                messages.Add(new { role, content });
        }

        messages.Add(new { role = "user", content = task });

        var model = await _settings.Get("AI:ModelName", "deepseek-v4-pro");
        var temperature = await _settings.GetDouble("AI:Temperature", 0.7);
        var baseUrl = await _settings.Get("AI:DeepSeekBaseUrl", "https://api.deepseek.com");

        var agentTimeoutMin = await _settings.GetInt("AI:AgentTimeoutMinutes", 20);
        var maxTokens = await _settings.GetInt("AI:MaxTokens", 8192);
        var reqTimeoutSec = await _settings.GetInt("AI:RequestTimeoutSeconds", 300);
        var enableThinking = await _settings.Get("AI:EnableThinking", "false") == "true";
        var reasoningEffort = await _settings.Get("AI:ReasoningEffort", "medium");

        _log.Info("agent", $"Agent start: task={task[..Math.Min(80, task.Length)]}, history={history?.Count ?? 0}, model={model}, timeout={agentTimeoutMin}min, maxTokens={maxTokens}, thinking={enableThinking}", null, userName);

        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(agentTimeoutMin));
        var iteration = 0;
        var toolCallCount = 0;
        while (!timeoutCts.Token.IsCancellationRequested)
        {
            var apiStart = DateTime.UtcNow;
            var payloadObj = new Dictionary<string, object>
            {
                ["model"] = model,
                ["messages"] = messages,
                ["temperature"] = temperature,
                ["top_p"] = 1.0,
                ["max_tokens"] = maxTokens,
                ["tools"] = tools.Select(t => new { type = "function", function = new { name = t.Name, description = t.Description, parameters = t.Parameters ?? new { type = "object", properties = new { } } } }).ToList(),
                ["tool_choice"] = "auto"
            };

            if (enableThinking)
            {
                payloadObj["reasoning_effort"] = reasoningEffort;
                payloadObj["thinking"] = new { type = "enabled" };
            }

            var json = JsonSerializer.Serialize(payloadObj);
            var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.Add("Authorization", $"Bearer {apiKey}");

            using var reqCts = CancellationTokenSource.CreateLinkedTokenSource(timeoutCts.Token);
            reqCts.CancelAfter(TimeSpan.FromSeconds(reqTimeoutSec));
            HttpResponseMessage resp;
            string body;
            try
            {
                resp = await _http.SendAsync(req, reqCts.Token);
                body = await resp.Content.ReadAsStringAsync(reqCts.Token);
            }
            catch (OperationCanceledException) when (!timeoutCts.Token.IsCancellationRequested)
            {
                _log.Warn("agent", $"Request timeout iter {iteration}: {reqTimeoutSec}s", null, userName);
                return $"❌ 单次 API 请求超时 ({reqTimeoutSec}秒)，请增大 AI:RequestTimeoutSeconds 设置或简化任务";
            }
            var apiMs = (int)(DateTime.UtcNow - apiStart).TotalMilliseconds;

            if (!resp.IsSuccessStatusCode)
            {
                _log.Error("agent", $"API error iter {iteration}", $"HTTP {resp.StatusCode}: {body[..Math.Min(200, body.Length)]} (took {apiMs}ms)", userName);
                if ((int)resp.StatusCode == 429) return "❌ API 频率限制，请稍后再试";
                return $"❌ API 错误 ({resp.StatusCode}): {body[..Math.Min(body.Length, 200)]}";
            }
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
            {
                _log.Error("agent", $"API empty response iter {iteration}", body[..Math.Min(200, body.Length)], userName);
                return $"❌ API 响应异常: {body[..Math.Min(body.Length, 300)]}";
            }
            var choice = choices[0];
            var msg = choice.GetProperty("message");

            if (msg.TryGetProperty("tool_calls", out var calls) && calls.GetArrayLength() > 0)
            {
                _log.Info("agent", $"Tool calls iter {iteration}: {calls.GetArrayLength()} tools (API took {apiMs}ms)", null, userName);

                // Execute all tools and collect results
                var toolResults = new List<(string callId, string name, string args, string result)>();
                foreach (var tc in calls.EnumerateArray())
                {
                    var fn = tc.GetProperty("function");
                    var name = fn.GetProperty("name").GetString()!;
                    var args = fn.GetProperty("arguments").GetString()!;
                    var callId = tc.GetProperty("id").GetString()!;

                    var toolStart = DateTime.UtcNow;
                    var result = await ExecuteTool(name, args, userName);
                    var toolMs = (int)(DateTime.UtcNow - toolStart).TotalMilliseconds;

                    var truncatedArgs = args.Length > 100 ? args[..100] + "..." : args;
                    _log.Info("agent", $"Tool: {name}({truncatedArgs}) — {toolMs}ms", null, userName);

                    toolResults.Add((callId, name, args, result));
                    toolCallCount++;
                }

                // Build ONE assistant message with ALL tool calls + preserve reasoning_content (V4 requirement)
                var assistantMsg = new Dictionary<string, object>
                {
                    ["role"] = "assistant",
                    ["tool_calls"] = calls.EnumerateArray().Select(tc => new
                    {
                        id = tc.GetProperty("id").GetString(),
                        type = "function",
                        function = new
                        {
                            name = tc.GetProperty("function").GetProperty("name").GetString(),
                            arguments = tc.GetProperty("function").GetProperty("arguments").GetString()
                        }
                    }).ToArray()
                };

                // Preserve content (may be null in tool call responses)
                if (msg.TryGetProperty("content", out var content) && content.ValueKind != JsonValueKind.Null)
                    assistantMsg["content"] = content.GetString();

                // Preserve reasoning_content — V4 requires this to be passed back
                if (msg.TryGetProperty("reasoning_content", out var reasoning) && reasoning.ValueKind != JsonValueKind.Null)
                    assistantMsg["reasoning_content"] = reasoning.GetString();

                var toolMsgs = new List<object> { assistantMsg };

                // Add tool result messages
                foreach (var (callId, _, _, result) in toolResults)
                    toolMsgs.Add(new { role = "tool", tool_call_id = callId, content = result[..Math.Min(result.Length, 4000)] });

                messages.AddRange(toolMsgs);
            }
            else
            {
                var response = msg.GetProperty("content").GetString() ?? "无响应";
                _log.Info("agent", $"Agent done: {iteration} iters, {toolCallCount} tool calls, response={response.Length} chars", null, userName);
                return response;
            }
        }

        _log.Warn("agent", $"Agent timeout: {iteration} iters, {toolCallCount} tools", null, userName);
        return $"分析超时（{iteration}轮/{agentTimeoutMin}分钟），请增大 AI:AgentTimeoutMinutes 设置或简化任务";
    }
}
