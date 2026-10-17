using System.Text;
using System.Text.Json;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// AI 系统管理员 —— 面向管理员的**只读**运维助手：健康巡检、日志排障、数据查询、操作答疑。
/// 通过 **OpenAI 兼容** function calling 调用一组只读工具（见 SystemAgentService.Prompt.cs）。
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
    private readonly AiClient _ai;

    public SystemAgentService(HttpClient http, IConfiguration config, AppDbContext db, LogService log,
        SettingsService settings, BackupService backup, KnowledgeService knowledge, KnowledgeSearchService search,
        AiClient ai)
    {
        _http = http;
        _db = db;
        _log = log;
        _settings = settings;
        _config = config;
        _backup = backup;
        _knowledge = knowledge;
        _search = search;
        _ai = ai;
    }

    /// <summary>Main entry: runs a read-only agent session with tools + conversation memory.</summary>
    public async Task<string> RunAgent(string task, string userName, List<(string role, string content)>? history = null)
    {
        // 统一配置解析（AiClient.ResolveAsync = 系统设置 AI:*）：
        // 之前这里 baseUrl 读 `AI:DeepSeekBaseUrl`，而设置页写的是 `AI:BaseUrl` —— 用户换端点对 Agent 无效；
        // model 兜底还写死 `deepseek-v4-pro`。这就是"写死 deepseek"的另一处实证。
        var opt = await _ai.ResolveAsync();
        if (string.IsNullOrEmpty(opt.ApiKey)) return "❌ AI 密钥未配置";

        var messages = new List<object> { new { role = "system", content = BuildSystemPrompt() } };
        if (history != null && history.Count > 0)
        {
            foreach (var (role, content) in history)
                messages.Add(new { role, content });
        }
        messages.Add(new { role = "user", content = task });

        var model = opt.Model;
        var agentTimeoutMin = await _settings.GetInt("AI:AgentTimeoutMinutes", 20);
        var reqTimeoutSec = opt.RequestTimeoutSeconds;
        var maxIterations = await _settings.GetInt("AI:MaxIterations", 25);

        _log.Info("agent", $"Agent start: task={task[..Math.Min(80, task.Length)]}, history={history?.Count ?? 0}, model={model}, timeout={agentTimeoutMin}min, maxTokens={opt.MaxTokens}, thinking={opt.Thinking}", null, userName);

        var tools = BuildTools();
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(agentTimeoutMin));
        var iteration = 0;
        var toolCallCount = 0;

        while (!timeoutCts.Token.IsCancellationRequested && iteration < maxIterations)
        {
            // 统一 payload 构造：thinking/reasoning_effort 只对 DeepSeek 下发，
            // temperature 与 top_p 按是否思考择一（官方文档：二者互斥，同时发等于都没用对）。
            // 之前手拼 payload：无论 Provider 都发 thinking → 配第三方 OpenAI 兼容端点可能直接 400。
            var toolSpecs = tools.Select(t => new
            {
                type = "function",
                function = new
                {
                    name = t.Name,
                    description = t.Description,
                    parameters = t.Parameters ?? new { type = "object", properties = new { } },
                },
            }).ToList();

            var payload = _ai.BuildChatPayload(
                opt, messages, stream: false, tools: toolSpecs, toolChoice: "auto",
                maxTokens: opt.MaxTokens, temperature: opt.Temperature);

            var reply = await PostChatAsync(JsonSerializer.Serialize(payload), opt.ApiKey, opt.BaseUrl, reqTimeoutSec, timeoutCts.Token, userName);
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
