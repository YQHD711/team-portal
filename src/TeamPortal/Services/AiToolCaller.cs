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
/// 流程：请求 → 有 `tool_calls` 就执行回调、追加 assistant 回放 + `role:"tool"` 结果 → 再请求；
/// 没有 `tool_calls` 即拿到最终回答。迭代上限 <see cref="MaxIterations"/>，超限返回可读错误。
/// </summary>
public class AiToolCaller
{
    /// <summary>工具循环最大轮数（防止模型无限调工具）</summary>
    public const int MaxIterations = 8;

    private readonly AiClient _ai;

    public AiToolCaller(AiClient ai) => _ai = ai;

    /// <param name="opt">已解析的 AI 配置（Provider/BaseUrl/ApiKey/Model/Thinking…）</param>
    /// <param name="messages">对话消息（会被原地追加 assistant/tool 消息）</param>
    /// <param name="tools">OpenAI 形状的 tools 数组；为 null 时退化成普通单轮对话</param>
    /// <param name="executeTool">执行工具：入参 (工具名, 参数 JSON)，返回工具结果字符串（应是 JSON）</param>
    public async Task<AiToolResult> RunAsync(
        AiOptions opt,
        List<Dictionary<string, object?>> messages,
        IEnumerable<object>? tools,
        Func<string, string, Task<string>> executeTool,
        int? maxTokens = null,
        CancellationToken ct = default)
    {
        for (var i = 1; i <= MaxIterations; i++)
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

            // 回放 assistant 的这一轮 tool_calls（OpenAI 要求下一轮请求里带上，否则 400）
            messages.Add(new Dictionary<string, object?>
            {
                ["role"] = "assistant",
                ["content"] = content,
                ["tool_calls"] = calls.Select(c => (object)new Dictionary<string, object?>
                {
                    ["id"] = c.Id,
                    ["type"] = "function",
                    ["function"] = new Dictionary<string, object?> { ["name"] = c.Name, ["arguments"] = c.Arguments },
                }).ToList(),
            });

            foreach (var call in calls)
            {
                string result;
                try { result = await executeTool(call.Name, call.Arguments); }
                catch (Exception ex)
                {
                    // 工具自身失败也要把原因回给模型，而不是让整个请求崩掉
                    result = JsonSerializer.Serialize(new { error = ex.Message });
                }
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = call.Id,
                    ["content"] = result,
                });
            }
        }

        return new(false, null, $"AI 工具调用超过 {MaxIterations} 轮仍未给出最终回答（可能存在循环调用）", MaxIterations);
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

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
