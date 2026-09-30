using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// 统一的 AI 接入层：解析配置、拼请求、按服务商决定发哪些参数。
///
/// 之前 5 个调用点各自拼 ``{base}/v1/chat/completions`` 并各发各的参数，导致：
/// ① 默认模型名漂移成 ``deepseek-chat``（官方现行列表里已经没有它）；
/// ② 关闭思考用的是 ``extra_body: { thinking_mode: "non-thinking" }`` ——
///    ``extra_body`` 是 OpenAI **Python SDK** 的包装概念，原生 HTTP 里根本不存在这个字段，
///    ``thinking_mode`` 也不是官方参数名 → 服务端直接忽略，**思考模式实际一直开着**；
/// ③ temperature 与 top_p 同时发，而官方文档明确：思考模式下 temperature 无效、
///    非思考模式下 top_p 被忽略（固定 1.0）——发两个等于一个都没用对。
/// </summary>
public class AiClient
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly SettingsService _settings;

    public AiClient(HttpClient http, IConfiguration config, SettingsService settings)
    {
        _http = http; _config = config; _settings = settings;
    }

    /// <summary>取设置项；库里没有则回退到配置 / 环境变量（密钥用环境变量注入是部署常规做法）</summary>
    private async Task<string> Get(string key, string envKey, string fallback)
    {
        var v = await _settings.Get(key, "");
        if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
        return (_config.GetValue<string>(envKey) ?? Environment.GetEnvironmentVariable(envKey) ?? fallback).Trim();
    }

    /// <summary>解析当前生效的接入配置</summary>
    public async Task<AiOptions> ResolveAsync()
    {
        var providerRaw = await _settings.Get("AI:Provider", "deepseek");
        var provider = providerRaw.Equals("openai", StringComparison.OrdinalIgnoreCase)
            ? AiProvider.OpenAiCompatible
            : AiProvider.DeepSeek;

        var baseUrl = await Get("AI:BaseUrl", "AiService:BaseUrl", AiOptions.DeepSeekDefaultBaseUrl);
        var apiKey = await Get("AI:ApiKey", "AiService:ApiKey", "");

        var model = await _settings.Get("AI:ModelName", "");
        if (string.IsNullOrWhiteSpace(model)) model = "deepseek-flash"; // 官方现行模型（旧的 deepseek-chat 已不在列表）

        return new AiOptions(
            Provider: provider,
            BaseUrl: string.IsNullOrWhiteSpace(baseUrl) ? AiOptions.DeepSeekDefaultBaseUrl : baseUrl,
            ApiKey: apiKey,
            Model: model.Trim(),
            Thinking: (await _settings.Get("AI:EnableThinking", "false")).Equals("true", StringComparison.OrdinalIgnoreCase),
            ReasoningEffort: await _settings.Get("AI:ReasoningEffort", "high"),
            Temperature: await _settings.GetDouble("AI:Temperature", 1.0),
            MaxTokens: await _settings.GetInt("AI:MaxTokens", 8192),
            RequestTimeoutSeconds: await _settings.GetInt("AI:RequestTimeoutSeconds", 300));
    }

    /// <summary>
    /// 构造 chat/completions 的请求体。
    ///
    /// 参数只发官方文档里存在、且在当前模式下**确实生效**的那些：
    /// - ``thinking`` / ``reasoning_effort`` 只在 DeepSeek 下发 —— 发给通用 OpenAI 兼容服务
    ///   可能直接 400（对方不认识这个字段）
    /// - 思考模式发 top_p 不发 temperature；非思考模式反过来
    /// - 不再发 frequency_penalty / presence_penalty（官方已标记 deprecated，传了也不生效）
    /// </summary>
    public Dictionary<string, object?> BuildChatPayload(
        AiOptions opt, IEnumerable<object> messages, bool stream,
        object? tools = null, string? toolChoice = null,
        int? maxTokens = null, double? temperature = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = opt.Model,
            ["messages"] = messages,
            ["stream"] = stream,
            ["max_tokens"] = maxTokens ?? opt.MaxTokens,
        };

        if (tools is not null)
        {
            payload["tools"] = tools;
            // 文档：思考模式下 "required" 与具名 tool_choice 会 400，auto 可用
            payload["tool_choice"] = toolChoice ?? "auto";
        }

        if (opt.Thinking)
        {
            // 文档：top_p 只在思考模式生效，且有效区间是 0.95–1.0（低于 0.95 会被当成 0.95）。
            // 我们不暴露这个旋钮，按官方默认值 1 发即可。
            payload["top_p"] = 1.0;
            if (opt.Provider == AiProvider.DeepSeek)
            {
                payload["thinking"] = new { type = "enabled" };
                payload["reasoning_effort"] = NormalizeEffort(opt.ReasoningEffort);
            }
        }
        else
        {
            // 非思考模式：temperature 生效，top_p 被服务端忽略
            payload["temperature"] = temperature ?? opt.Temperature;
            if (opt.Provider == AiProvider.DeepSeek)
                payload["thinking"] = new { type = "disabled" };
        }

        if (stream) payload["stream_options"] = new { include_usage = true };
        return payload;
    }

    /// <summary>
    /// 官方现行 effort 为 none/low/high/max；medium 与 minimal 是历史别名
    /// （medium→high、minimal→low），这里先归一到现行取值，避免设置页留下无效值。
    /// </summary>
    public static string NormalizeEffort(string? raw) => (raw ?? "").Trim().ToLowerInvariant() switch
    {
        "none" => "none",
        "low" or "minimal" => "low",
        "max" => "max",
        _ => "high", // high / medium / xhigh / 未知 一律按 high（官方默认）
    };

    public HttpRequestMessage CreateChatRequest(AiOptions opt, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, opt.ChatEndpoint)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("Authorization", $"Bearer {opt.ApiKey}");
        return req;
    }

    /// <summary>发请求（流式时用 ResponseHeadersRead，避免把整段回答先缓冲完）</summary>
    public Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage req,
        HttpCompletionOption completion = HttpCompletionOption.ResponseContentRead)
        => _http.SendAsync(req, completion);

    /// <summary>把 AI 的流式增量里能显示的部分取出来（丢弃 reasoning_content —— 前端只渲染正文）</summary>
    public static string? ExtractDeltaContent(JsonElement root)
        => root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0
           && choices[0].TryGetProperty("delta", out var delta)
           && delta.TryGetProperty("content", out var c)
            ? c.GetString()
            : null;

    /// <summary>非流式响应里的正文；思考模型的 reasoning_content 不参与展示</summary>
    public static string? ExtractMessageContent(JsonElement root)
        => root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0
           && choices[0].TryGetProperty("message", out var msg)
           && msg.TryGetProperty("content", out var c)
            ? c.GetString()
            : null;

    // ── 模型列表 ──

    public sealed record AiModelInfo(
        string Id, string? Name, int? ContextWindow, int? MaxOutputTokens,
        string[] InputModalities, string[] OutputModalities, string[] EffortLevels);

    /// <summary>
    /// GET /models —— 官方接口本身是 OpenAI 兼容的；DeepSeek 还会多返回展示名、
    /// 上下文长度、最大输出、模态与 effort 档位，这些正好用来填设置页。
    /// 通用服务可能只返回 id/object/owned_by，缺的字段一律留空而不是编造。
    /// </summary>
    public async Task<(bool Ok, string? Error, List<AiModelInfo> Models)> ListModelsAsync(AiOptions opt)
    {
        if (string.IsNullOrWhiteSpace(opt.ApiKey))
            return (false, "还没有填写 API Key", []);
        if (string.IsNullOrWhiteSpace(opt.BaseUrl))
            return (false, "还没有填写 API 地址", []);

        var req = new HttpRequestMessage(HttpMethod.Get, opt.ModelsEndpoint);
        req.Headers.Add("Authorization", $"Bearer {opt.ApiKey}");
        try
        {
            var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                return (false, $"服务端返回 {(int)resp.StatusCode}：{Truncate(body)}", []);

            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                return (false, "响应里没有 models 列表（可能不是 OpenAI 兼容接口）", []);

            var list = new List<AiModelInfo>();
            foreach (var m in data.EnumerateArray())
            {
                var id = m.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                if (string.IsNullOrWhiteSpace(id)) continue;
                list.Add(new AiModelInfo(
                    Id: id,
                    Name: Str(m, "name"),
                    ContextWindow: Int(m, "context_window"),
                    MaxOutputTokens: Int(m, "max_output_tokens"),
                    InputModalities: StrArray(m, "input_modalities"),
                    OutputModalities: StrArray(m, "output_modalities"),
                    EffortLevels: m.TryGetProperty("effort", out var eff) ? StrArray(eff, "supported_levels") : []));
            }
            return (true, null, list.OrderBy(x => x.Id, StringComparer.Ordinal).ToList());
        }
        catch (Exception ex)
        {
            return (false, $"请求失败：{ex.Message}", []);
        }
    }

    private static string Truncate(string s) => s[..Math.Min(200, s.Length)];

    private static string? Str(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int? Int(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null;

    private static string[] StrArray(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToArray()
            : [];
}
