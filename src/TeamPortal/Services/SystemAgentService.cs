using System.Text.Json;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// AI 系统管理员 —— 面向管理员的**只读**运维助手：健康巡检、日志排障、数据查询、操作答疑。
/// 通过 **OpenAI 兼容** function calling 调用一组只读工具（见 SystemAgentService.Prompt.cs）。
/// </summary>
/// <remarks>
/// 能力边界：本服务不写文件、不改设置、不生成代码、不编译、不重启（旧「代码提案 + 维护模式」
/// 与容器化部署冲突：镜像只有 publish 产物）。
/// 职责拆分为 partial：Prompt / Tools / Data / Guide / Transport。
/// task-13：工具循环提取为 <see cref="RunToolLoopAsync"/>，RunAgent（JSON）与
/// RunAgentStream（SSE）共用：工具轮 stream:false，只有最终作答 stream:true。
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

    /// <summary>Main entry: runs a read-only agent session with tools + conversation memory.
    /// 保留原 JSON 端点行为：工具轮非流式，模型不再调工具时直接返回该轮 content（不额外请求）。</summary>
    public async Task<string> RunAgent(string task, string userName, List<(string role, string content)>? history = null)
    {
        // 统一配置解析（AiClient.ResolveAsync = 系统设置 AI:*）：之前这里 baseUrl 读旧键、model 写死。
        var opt = await _ai.ResolveAsync();
        if (string.IsNullOrEmpty(opt.ApiKey)) return "❌ AI 密钥未配置";

        var messages = BuildMessages(task, history);
        var agentTimeoutMin = await _settings.GetInt("AI:AgentTimeoutMinutes", 20);
        var reqTimeoutSec = opt.RequestTimeoutSeconds;
        var maxIterations = await _settings.GetInt("AI:MaxIterations", 25);

        _log.Info("agent", $"Agent start: task={task[..Math.Min(80, task.Length)]}, history={history?.Count ?? 0}, model={opt.Model}, timeout={agentTimeoutMin}min, maxTokens={opt.MaxTokens}, thinking={opt.Thinking}", null, userName);

        var tools = BuildTools();
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(agentTimeoutMin));
        var outcome = await RunToolLoopAsync(opt, messages, tools, userName, maxIterations, reqTimeoutSec,
            timeoutCts.Token, null, null);

        if (outcome.Error is not null) return outcome.Error;
        if (outcome.HitCap)
        {
            _log.Warn("agent", $"Agent hit iteration cap: {outcome.Iterations}/{maxIterations} iters, {outcome.ToolCalls} tools", null, userName);
            return $"已达最大迭代次数（{maxIterations}轮），请增大 AI:MaxIterations 设置或简化问题";
        }
        if (outcome.TimedOut)
        {
            _log.Warn("agent", $"Agent timeout: {outcome.Iterations} iters, {outcome.ToolCalls} tools", null, userName);
            return $"分析超时（{outcome.Iterations}轮/{agentTimeoutMin}分钟），请增大 AI:AgentTimeoutMinutes 设置或简化问题";
        }

        var response = outcome.FinalContent ?? "无响应";
        _log.Info("agent", $"Agent done: {outcome.Iterations} iters, {outcome.ToolCalls} tool calls, response={response.Length} chars", null, userName);
        return response;
    }

    private sealed record ToolLoopOutcome(
        string? FinalContent, string? Error, int Iterations, int ToolCalls, bool HitCap, bool TimedOut);

    /// <summary>
    /// 共用工具循环（非流式带 tools）：模型不再调工具时返回该轮正文，供 JSON 端点直接作答；
    /// 流式端点忽略 FinalContent，改用同样的 messages 做最后一次 stream:true 请求。
    /// <paramref name="onRoundStart"/>/<paramref name="onToolsDone"/> 用于流式端点推送 status 事件。
    /// </summary>
    private async Task<ToolLoopOutcome> RunToolLoopAsync(AiOptions opt, List<object> messages, List<ToolDef> tools,
        string userName, int maxIterations, int reqTimeoutSec, CancellationToken ct,
        Func<int, Task>? onRoundStart, Func<int, IReadOnlyList<string>, Task>? onToolsDone)
    {
        var iteration = 0;
        var toolCallCount = 0;

        while (!ct.IsCancellationRequested && iteration < maxIterations)
        {
            if (onRoundStart is not null) await onRoundStart(iteration + 1);

            // 统一 payload 构造：thinking/reasoning_effort 只对 DeepSeek 下发；
            // temperature 与 top_p 按是否思考择一（官方文档：二者互斥）。
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

            ApiReply reply;
            try
            {
                reply = await PostChatAsync(JsonSerializer.Serialize(payload), opt.ApiKey, opt.BaseUrl, reqTimeoutSec, ct, userName);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return new(null, null, iteration, toolCallCount, false, true); // 总时长超时/客户端断开
            }
            if (reply.Error is not null) return new(null, reply.Error, iteration, toolCallCount, false, false);

            using var doc = JsonDocument.Parse(reply.Body);
            if (!doc.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
            {
                _log.Error("agent", $"API empty response iter {iteration}", reply.Body[..Math.Min(200, reply.Body.Length)], userName);
                return new(null, $"❌ API 响应异常: {reply.Body[..Math.Min(reply.Body.Length, 300)]}", iteration, toolCallCount, false, false);
            }
            var msg = choices[0].GetProperty("message");

            if (!msg.TryGetProperty("tool_calls", out var calls) || calls.GetArrayLength() == 0)
            {
                var response = msg.TryGetProperty("content", out var c) ? c.GetString() ?? "无响应" : "无响应";
                return new(response, null, iteration, toolCallCount, false, false); // 模型已给出答案
            }

            _log.Info("agent", $"Tool calls iter {iteration}: {calls.GetArrayLength()} tools (API took {reply.Ms}ms)", null, userName);
            var toolResults = new List<(string CallId, string Result)>();
            var names = new List<string>();
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
                names.Add(name);
                toolCallCount++;
            }
            if (onToolsDone is not null) await onToolsDone(iteration + 1, names);

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

        if (ct.IsCancellationRequested) return new(null, null, iteration, toolCallCount, false, true);
        return new(null, null, iteration, toolCallCount, true, false); // 达到迭代上限
    }
}
