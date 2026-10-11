using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// 聊天的「模型自主多轮检索」部分（task-16）：工具轮 <c>stream:false</c> + 带 tools，
/// 直到模型不再调工具为止；**最后一轮**才用 <c>stream:true</c> 不带 tools 把答案流式吐给前端
/// —— 所以 <c>POST /api/ai/chat</c> 的 SSE 契约与前端代码都不用改（只是首字节可能晚几秒）。
///
/// 硬上限（都可以在设置里调，但一定有上限）：<c>AI:MaxToolRounds</c> 默认 4（钳在 1..8）、
/// 单轮 ≤ <see cref="KnowledgeToolSession.MaxCallsPerRound"/> 个调用、
/// 工具返回总量 ≤ <see cref="KnowledgeToolSession.MaxTotalChars"/> 字符、单页 ≤ 8000 字符。
/// 轮数用满时追加一条"请基于已有资料作答"的提示再流式作答。
///
/// DeepSeek V4 的坑（照抄 SystemAgentService / WikiGeneratorService 的写法）：携带 tools 的请求，
/// 后续每轮**必须完整回传** assistant 的 content 与 reasoning_content，只回 role+tool_calls 会 400。
/// </summary>
public partial class AiProxyService
{
    internal const int DefaultMaxToolRounds = 4;
    private const int MaxToolRoundsCap = 8;

    /// <summary>
    /// 工具轮的总时长兜底（毫秒）：4 轮 × 单轮 300s 的请求超时叠加起来太久，必须有墙钟上限。
    /// 到点就不再跑工具轮、直接流式作答。测试可设成 0 验证该分支。
    /// </summary>
    internal int ToolLoopBudgetMs { get; set; } = 240_000;

    /// <summary>把"RAG 文档 + 实时块 + 提示词 + 历史 + 本轮问题"拼成消息列表（与原单轮实现一致）。</summary>
    private async Task<List<object>> BuildMessagesAsync(string question, SearchScope scope,
        List<(string role, string content)>? history)
    {
        var results = _search.Search(question, topK: 8, scope.Role, scope.Department, scope.UserId);
        // Filter: only include results with meaningful TF-IDF score (>5% of top score)
        var topScore = results.FirstOrDefault()?.Score ?? 0;
        var relevant = results.Where(r => r.Score >= topScore * 0.05).Take(5).ToList();
        var context = BuildContext(relevant);
        // RAG 可观测性：真正注入了多少文档/多少字（空转率另由 KnowledgeSearchService 的检索行统计）
        _log.Info(RagLog.Category, RagLog.ContextLine(context.Length, relevant.Count));

        // 实时库存/货位：每次提问现查数据库（数量随时在变，写进索引会答过期数字）。不相关时返回 null。
        var live = await LiveInventoryContext.BuildAsync(question, _db);
        if (live is not null) _log.Info(RagLog.Category, $"RAG live: chars={live.Length}");

        var messages = new List<object> { new { role = "system", content = await ResolveSystemPrompt() } };
        if (history is { Count: > 0 })
            foreach (var (role, content) in history) messages.Add(new { role, content });

        // 无论有没有命中都注入 RAG 段：空结果时必须让模型先声明"未检索到队内资料"；
        // 有实时查询结果时那条声明要让位（见 RagInjectionFor）。
        // 再告诉模型它有两个只读检索工具 —— 资料不够时应该自己继续查/翻页，而不是只用一次。
        messages.Add(new { role = "system", content = RagInjectionFor(context, live) + ToolUsageHint(relevant.Count) });
        messages.Add(new { role = "user", content = question });
        return messages;
    }

    internal static string ToolUsageHint(int injectedDocs) =>
        "\n\n你还可以调用只读工具自己补充资料：search_knowledge(query, top_k?) 换关键词再检索，"
        + "read_document(path, offset?, length?) 分页读某份文档的正文。"
        + (injectedDocs == 0
            ? "当前注入的资料不足，请先用工具检索。"
            : "若现有资料不足以回答问题（例如只覆盖了长文档的开头），请继续用工具检索或翻页，别急着下结论。");

    /// <summary>工具轮 + 最后一轮流式答案。任何工具轮异常都退化为"直接流式回答"，不影响可用性。</summary>
    private async Task<Stream?> AgenticChatAsync(AiOptions opt, List<object> messages, SearchScope scope)
    {
        var session = new KnowledgeToolSession(_search, _knowledge, scope.Role, scope.Department, scope.UserId);
        var maxRounds = Math.Clamp(await _settings.GetInt("AI:MaxToolRounds", DefaultMaxToolRounds), 1, MaxToolRoundsCap);
        var rounds = 0;
        var calls = 0;
        var names = new List<string>();
        var stoppedByCap = false;
        var deadline = Environment.TickCount64 + ToolLoopBudgetMs;

        while (true)
        {
            if (rounds >= maxRounds) { stoppedByCap = true; break; }   // 上一轮模型还要工具，但轮数用完了
            if (Environment.TickCount64 >= deadline)
            {
                _log.Warn(RagLog.Category, $"RAG tools: 工具轮总时长超过 {ToolLoopBudgetMs}ms，提前转入作答");
                break;
            }
            rounds++;
            var (calledTools, executed) = await TryRunToolRoundAsync(opt, messages, session, names);
            calls += executed;
            if (!calledTools) break;
        }

        if (stoppedByCap)
        {
            // 到上限了：明确告诉模型"别再查了，用已有资料尽量答完"
            messages.Add(new { role = "system", content = "已达到本轮检索次数上限，请基于已有资料尽量完整地作答；确实缺失的部分请明确说明。" });
        }

        var payload = _ai.BuildChatPayload(opt, messages, stream: true);
        var response = await _ai.SendAsync(_ai.CreateChatRequest(opt, payload), HttpCompletionOption.ResponseHeadersRead);
        _log.Info(RagLog.Category, RagLog.ToolsLine(rounds, calls, session.SpentChars, names));
        return response.IsSuccessStatusCode ? await response.Content.ReadAsStreamAsync() : null;
    }

    /// <summary>
    /// 跑一轮"带工具"请求。CalledTools=true 表示模型确实调用了工具（结果已写回 messages，可以再来一轮）；
    /// false 表示模型已经给出答案 / 请求失败 —— 调用方应转入流式作答。
    /// </summary>
    private async Task<(bool CalledTools, int Executed)> TryRunToolRoundAsync(AiOptions opt, List<object> messages,
        KnowledgeToolSession session, List<string> names)
    {
        var payload = _ai.BuildChatPayload(opt, messages, stream: false, tools: KnowledgeToolSession.Definitions);
        HttpResponseMessage response;
        try
        {
            response = await _ai.SendAsync(_ai.CreateChatRequest(opt, payload));
        }
        catch (Exception ex)
        {
            _log.Warn(RagLog.Category, $"RAG tools: 工具轮请求失败（{ex.Message}），改为直接流式回答");
            return (false, 0);
        }
        if (!response.IsSuccessStatusCode) return (false, 0);

        var parsed = ParseToolRound(await response.Content.ReadAsStringAsync());
        if (parsed is null || parsed.Calls.Count == 0) return (false, 0);

        var assistant = new Dictionary<string, object> { ["role"] = "assistant" };
        if (parsed.Content is not null) assistant["content"] = parsed.Content;                 // V4：必须回传
        if (parsed.Reasoning is not null) assistant["reasoning_content"] = parsed.Reasoning;   // V4：缺失会 400
        assistant["tool_calls"] = parsed.Calls.Select(c => new
        {
            id = c.Id, type = "function",
            function = new { name = c.Name, arguments = c.Arguments },
        }).ToArray();
        messages.Add(assistant);

        var executed = 0;
        foreach (var call in parsed.Calls)
        {
            // 单轮调用数上限：超出的一样要回 tool 消息（否则 tool_call 没响应，OpenAI 兼容接口会 400）
            var overLimit = executed >= KnowledgeToolSession.MaxCallsPerRound;
            var result = overLimit
                ? "{\"error\":\"单轮工具调用已达上限（3），请基于已有结果作答\"}"
                : session.Execute(call.Name, call.Arguments);
            if (!overLimit)
            {
                executed++;
                names.Add(call.Name);
            }
            messages.Add(new { role = "tool", tool_call_id = call.Id, content = result });
        }
        return (true, executed);
    }

    private sealed record ToolCall(string Id, string Name, string Arguments);
    private sealed record ToolRound(List<ToolCall> Calls, string? Content, string? Reasoning);

    /// <summary>解析带工具的响应；结构不认识就返回 null（调用方退化为流式作答）。</summary>
    private static ToolRound? ParseToolRound(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0) return null;
            if (!choices[0].TryGetProperty("message", out var msg)) return null;
            if (!msg.TryGetProperty("tool_calls", out var toolCalls) || toolCalls.ValueKind != JsonValueKind.Array) return null;

            var calls = new List<ToolCall>();
            foreach (var tc in toolCalls.EnumerateArray())
            {
                if (!tc.TryGetProperty("function", out var fn)) continue;
                var name = fn.TryGetProperty("name", out var n) ? n.GetString() : null;
                var id = tc.TryGetProperty("id", out var i) ? i.GetString() : null;
                if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(id)) continue;
                var args = fn.TryGetProperty("arguments", out var a) ? a.GetString() ?? "{}" : "{}";
                calls.Add(new ToolCall(id, name, args));
            }
            return new ToolRound(calls, ReadString(msg, "content"), ReadString(msg, "reasoning_content"));
        }
        catch
        {
            return null;
        }
    }

    private static string? ReadString(JsonElement element, string name)
        => element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
