using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>一次工具调用（OpenAI 兼容形状：id / function.name / function.arguments）</summary>
public sealed record AiToolCall(string Id, string Name, string Arguments);

/// <summary>工具调用循环的结果。<see cref="Ok"/>=false 时 <see cref="Error"/> 必有可读原因（不静默返回空）。</summary>
public sealed record AiToolResult(bool Ok, string? Content, string? Error, int Iterations);

/// <summary>
/// 通用 **OpenAI 兼容**的工具调用循环（function calling），供 Wiki 生成等需要 tools 的链路使用。
///
/// 为什么不塞进 <see cref="AiClient"/>：后者已 226 行且被 5 处依赖，改成 partial 会动到既有结构；
/// 这里用组合方式复用它的请求构造/发送，**保证 `Provider=DeepSeek` 时才下发
/// `thinking`/`reasoning_effort` 这个判断不被绕过**（逻辑仍在 <see cref="AiClient.BuildChatPayload"/>）。
///
/// 三个**可选**能力（默认关闭/保持通用行为，Wiki 侧显式开启旧值）：
///  - <c>echoReasoningContent</c>：把响应里的 `reasoning_content` 回放到下一轮 assistant 消息。
///    **只在 `Provider=DeepSeek` 且显式开启时生效** —— DeepSeek 思考模式要求每轮回传，
///    但 OpenAI 等严格服务对未知 assistant 字段可能 400，不能把 DeepSeek 的坑变成别家的坑。
///  - <c>maxIterations</c> / <c>timeoutError</c>：循环上限与超限错误文案（Wiki 需要 50 轮 + 原错误语义）。
///  - <c>toolResultMaxChars</c>：工具结果截断上限（截断后加 `…[truncated]` 标记，不静默截）。
/// </summary>
public class AiToolCaller
{
    /// <summary>工具循环默认最大轮数（防模型无限调工具）</summary>
    public const int MaxIterations = 8;

    private readonly AiClient _ai;

    public AiToolCaller(AiClient ai) => _ai = ai;

    public async Task<AiToolResult> RunAsync(
        AiOptions opt,
        List<Dictionary<string, object?>> messages,
        IEnumerable<object>? tools,
        Func<string, string, Task<string>> executeTool,
        int? maxTokens = null,
        bool echoReasoningContent = false,
        int? maxIterations = null,
        string? timeoutError = null,
        int? toolResultMaxChars = null,
        CancellationToken ct = default)
    {
        var limit = maxIterations ?? MaxIterations;
        // reasoning_content 只在 DeepSeek 且显式开启时回放（见类注释）
        var replayReasoning = echoReasoningContent && opt.Provider == AiProvider.DeepSeek;

        for (var i = 1; i <= limit; i++)
        {
            var payload = _ai.BuildChatPayload(opt, messages, stream: false, tools: tools, maxTokens: maxTokens);
            using var req = _ai.CreateChatRequest(opt, payload);
            using var res = await _ai.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync(ct);

            if (!res.IsSuccessStatusCode)
                return new(false, null, $"AI 请求失败（HTTP {(int)res.StatusCode}）：{Truncate(body, 300)}", i);

            JsonElement root;
            try { root = JsonDocument.Parse(body).RootElement; }
            catch (JsonException) { return new(false, null, "AI 返回的不是合法 JSON", i); }

            var content = AiClient.ExtractMessageContent(root);
            var calls = ParseToolCalls(root);
            if (calls.Count == 0)
                return new(true, content ?? "", null, i);

            var assistant = new Dictionary<string, object?>
            {
                ["role"] = "assistant",
                ["content"] = content,
                ["tool_calls"] = calls.Select(c => (object)new Dictionary<string, object?>
                {
                    ["id"] = c.Id,
                    ["type"] = "function",
                    ["function"] = new Dictionary<string, object?> { ["name"] = c.Name, ["arguments"] = c.Arguments },
                }).ToList(),
            };
            if (replayReasoning)
            {
                var reasoning = ExtractReasoningContent(root);
                if (!string.IsNullOrEmpty(reasoning)) assistant["reasoning_content"] = reasoning;
            }
            // OpenAI 要求下一轮请求带回 assistant 的 tool_calls，否则 400
            messages.Add(assistant);

            foreach (var call in calls)
            {
                string result;
                try { result = await executeTool(call.Name, call.Arguments); }
                catch (Exception ex)
                {
                    // 工具自身失败也要把原因回给模型，而不是让整个请求崩掉
                    result = JsonSerializer.Serialize(new { error = ex.Message });
                }
                if (toolResultMaxChars is int cap && result.Length > cap)
                    result = result[..cap] + "…[truncated]";
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = call.Id,
                    ["content"] = result,
                });
            }
        }

        return new(false, null,
            timeoutError ?? $"AI 工具调用超过 {limit} 轮仍未给出最终回答（可能存在循环调用）", limit);
    }

    /// <summary>解析 `choices[0].message.tool_calls[]`；没有则返回空列表</summary>
    public static List<AiToolCall> ParseToolCalls(JsonElement root)
    {
        var result = new List<AiToolCall>();
        if (!root.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array
            || choices.GetArrayLength() == 0) return result;
        if (!choices[0].TryGetProperty("message", out var msg)) return result;
        if (!msg.TryGetProperty("tool_calls", out var calls) || calls.ValueKind != JsonValueKind.Array) return result;

        foreach (var call in calls.EnumerateArray())
        {
            var id = call.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
            var name = "";
            var args = "{}";
            if (call.TryGetProperty("function", out var fn))
            {
                if (fn.TryGetProperty("name", out var n)) name = n.GetString() ?? "";
                if (fn.TryGetProperty("arguments", out var a))
                    args = a.ValueKind == JsonValueKind.String ? a.GetString() ?? "{}" : a.GetRawText();
            }
            if (name.Length > 0) result.Add(new AiToolCall(id, name, args));
        }
        return result;
    }

    /// <summary>取 `choices[0].message.reasoning_content`（DeepSeek 思考模式回传用）</summary>
    public static string? ExtractReasoningContent(JsonElement root)
        => root.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array
           && choices.GetArrayLength() > 0 && choices[0].TryGetProperty("message", out var msg)
           && msg.TryGetProperty("reasoning_content", out var rc) && rc.ValueKind == JsonValueKind.String
            ? rc.GetString()
            : null;

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
