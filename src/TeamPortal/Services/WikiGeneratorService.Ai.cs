namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的 **AI 调用层**：带 function calling 的对话循环。
///
/// 这里的实现**不再自己拼 `/chat/completions`**（原 `WikiGeneratorService.DeepSeek.cs` 的写法），
/// 而是走通用 OpenAI 兼容的 <see cref="AiToolCaller"/> —— 用户要求"模型选择与 API 支持兼容 OpenAI 的格式，
/// 不要写死 DeepSeek"。DeepSeek 专有字段（thinking/reasoning_effort）由 <see cref="AiClient.BuildChatPayload"/>
/// 按 `Provider` 决定是否下发，这里不重复判断。
///
/// 行为与收编前保持一致的三个参数（缺一都会造成回归）：
///  - `echoReasoningContent: true`：思考模式多轮工具调用必须回传上一轮 `reasoning_content`，否则 400
///  - `maxIterations: 50`：原循环上限就是 50
///  - `toolResultMaxChars: 8000`：原实现对工具结果做 8000 字符截断
/// </summary>
public partial class WikiGeneratorService
{
    private async Task<string> CallAiWithTools(string systemPrompt, string userMessage, List<ToolDef> tools, string taskDesc, string? modelName = null)
    {
        var aiTools = _aiTools ?? throw new InvalidOperationException("AiToolCaller 未注入");
        // 模型解析顺序：任务级显式指定 → Wiki 设置 → **系统设置 AI:ModelName**。
        // 最后一档是本次补的：Wiki 设置的模型字段现在允许留空（不再写死 deepseek-*），
        // 留空就必须真的回落到系统设置，否则会拿空字符串去请求（model="" → 400）。
        var model = modelName;
        if (string.IsNullOrWhiteSpace(model)) model = _options.ContentModel;
        if (string.IsNullOrWhiteSpace(model)) model = await ResolveSystemModelAsync();
        // ReasoningEffort 不覆盖：让它跟随全局配置 AI:ReasoningEffort 的默认值（与收编前一致）
        var option = new AiOptions(
            Provider: await GetProviderAsync(),
            BaseUrl: await GetBaseUrl(),
            ApiKey: await GetApiKey(),
            Model: model,
            Thinking: _options.ThinkingMode == "thinking",
            ReasoningEffort: "high",
            Temperature: _options.Temperature,
            MaxTokens: _options.MaxOutputTokens,
            RequestTimeoutSeconds: _options.DocumentGenerationTimeoutMinutes * 60);

        var messages = new List<Dictionary<string, object?>>
        {
            new() { ["role"] = "system", ["content"] = systemPrompt },
            new() { ["role"] = "user", ["content"] = userMessage },
        };

        var toolDefs = tools.Select(t => (object)new
        {
            type = "function",
            function = new { name = t.Name, description = t.Description, parameters = t.Parameters }
        }).ToList();

        var result = await aiTools.RunAsync(
            option,
            messages,
            toolDefs,
            async (name, args) =>
            {
                _logger.LogInformation("AI Tool call: {Func}({Args})", name, args[..Math.Min(args.Length, 100)]);
                return await ExecuteTool(name, args);
            },
            maxTokens: _options.MaxOutputTokens,
            echoReasoningContent: true,
            maxIterations: 50,
            timeoutError: $"AI agent timed out after {_options.DocumentGenerationTimeoutMinutes} minutes",
            toolResultMaxChars: 8000);

        if (!result.Ok)
            throw new InvalidOperationException(result.Error ?? "AI 调用失败");

        _logger.LogInformation("AI generation complete ({Task}), {Len} chars", taskDesc, result.Content?.Length ?? 0);
        return result.Content ?? "";
    }
}
