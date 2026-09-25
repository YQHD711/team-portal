using System.Text;
using System.Text.Json;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// AI 系统管理员 —— 面向管理员的**只读**运维助手：健康巡检、日志排障、数据查询、操作答疑。
/// 通过 DeepSeek function calling 调用一组只读工具（见 SystemAgentService.Prompt.cs）。
/// </summary>
/// <remarks>
/// 能力边界：本服务不写文件、不改设置、不生成代码、不编译、不重启（历史上那套「代码提案 + 维护模式」
/// 与容器化部署冲突：镜像只拷贝 publish 产物，源码不在容器里，编译产物也不会生效）。
/// 其余职责拆分为 partial：Prompt（提示词与工具声明）、Tools（分发与系统层工具）、
/// Data（备份/设置/知识库/团队）、Guide（管理员手册）。
/// </remarks>
public partial class SystemAgentService
{
    private readonly HttpClient _http;
    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly IConfiguration _config;
    private readonly BackupService _backup;
    private readonly KnowledgeService _knowledge;
    private readonly KnowledgeSearchService _search;

    public SystemAgentService(HttpClient http, IConfiguration config, AppDbContext db, LogService log,
        SettingsService settings, BackupService backup, KnowledgeService knowledge, KnowledgeSearchService search)
    {
        _http = http;
        _db = db;
        _log = log;
        _settings = settings;
        _config = config;
        _backup = backup;
        _knowledge = knowledge;
        _search = search;
    }

    /// <summary>Main entry: runs a read-only agent session with tools + conversation memory.</summary>
    public async Task<string> RunAgent(string task, string userName, List<(string role, string content)>? history = null)
    {
        var apiKey = await _settings.Get("AI:DeepSeekKey");
        if (string.IsNullOrEmpty(apiKey)) apiKey = _config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        if (string.IsNullOrEmpty(apiKey)) return "❌ AI 密钥未配置";

        var messages = new List<object> { new { role = "system", content = BuildSystemPrompt() } };
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
        var maxIterations = await _settings.GetInt("AI:MaxIterations", 25);

        _log.Info("agent", $"Agent start: task={task[..Math.Min(80, task.Length)]}, history={history?.Count ?? 0}, model={model}, timeout={agentTimeoutMin}min, maxTokens={maxTokens}, thinking={enableThinking}", null, userName);

        var tools = BuildTools();
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(agentTimeoutMin));
        var iteration = 0;
        var toolCallCount = 0;

        while (!timeoutCts.Token.IsCancellationRequested && iteration < maxIterations)
        {
            var payload = new Dictionary<string, object>
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
                payload["reasoning_effort"] = reasoningEffort;
                payload["thinking"] = new { type = "enabled" };
            }

            var reply = await PostChatAsync(JsonSerializer.Serialize(payload), apiKey, baseUrl, reqTimeoutSec, timeoutCts.Token, userName);
            if (reply.Error is not null) return reply.Error;

            using var doc = JsonDocument.Parse(reply.Body);
            if (!doc.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
            {
                _log.Error("agent", $"API empty response iter {iteration}", reply.Body[..Math.Min(200, reply.Body.Length)], userName);
                return $"❌ API 响应异常: {reply.Body[..Math.Min(reply.Body.Length, 300)]}";
            }
            var msg = choices[0].GetProperty("message");

            if (!msg.TryGetProperty("tool_calls", out var calls) || calls.GetArrayLength() == 0)
            {
                var response = msg.TryGetProperty("content", out var c) ? c.GetString() ?? "无响应" : "无响应";
                _log.Info("agent", $"Agent done: {iteration} iters, {toolCallCount} tool calls, response={response.Length} chars", null, userName);
                return response;
            }

            _log.Info("agent", $"Tool calls iter {iteration}: {calls.GetArrayLength()} tools (API took {reply.Ms}ms)", null, userName);
            var toolResults = new List<(string CallId, string Result)>();
            foreach (var tc in calls.EnumerateArray())
            {
                var fn = tc.GetProperty("function");
                var name = fn.GetProperty("name").GetString()!;
                var args = fn.GetProperty("arguments").GetString()!;
                var callId = tc.GetProperty("id").GetString()!;

                var toolStart = DateTime.UtcNow;
                var result = await ExecuteTool(name, args, userName);
                var toolMs = (int)(DateTime.UtcNow - toolStart).TotalMilliseconds;

                var shownArgs = args.Length > 100 ? args[..100] + "..." : args;
                _log.Info("agent", $"Tool: {name}({shownArgs}) — {toolMs}ms", null, userName);

                toolResults.Add((callId, result));
                toolCallCount++;
            }

            // 一条 assistant 消息携带全部 tool_calls，再逐条跟 tool 结果（V4 要求回传 reasoning_content）
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
            if (msg.TryGetProperty("content", out var content) && content.ValueKind != JsonValueKind.Null)
                assistantMsg["content"] = content.GetString() ?? "";
            if (msg.TryGetProperty("reasoning_content", out var reasoning) && reasoning.ValueKind != JsonValueKind.Null)
                assistantMsg["reasoning_content"] = reasoning.GetString() ?? "";

            messages.Add(assistantMsg);
            foreach (var (callId, result) in toolResults)
                messages.Add(new { role = "tool", tool_call_id = callId, content = result[..Math.Min(result.Length, 4000)] });

            iteration++;
        }

        if (iteration >= maxIterations)
        {
            _log.Warn("agent", $"Agent hit iteration cap: {iteration}/{maxIterations} iters, {toolCallCount} tools", null, userName);
            return $"已达最大迭代次数（{maxIterations}轮），请增大 AI:MaxIterations 设置或简化问题";
        }

        _log.Warn("agent", $"Agent timeout: {iteration} iters, {toolCallCount} tools", null, userName);
        return $"分析超时（{iteration}轮/{agentTimeoutMin}分钟），请增大 AI:AgentTimeoutMinutes 设置或简化问题";
    }
}
