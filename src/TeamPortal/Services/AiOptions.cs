namespace TeamPortal.Services;

/// <summary>AI 服务商类型。DeepSeek 与"任意 OpenAI 兼容服务"的差别只在默认值与少量专有参数。</summary>
public enum AiProvider
{
    /// <summary>DeepSeek 官方（默认）。会额外发送 thinking / reasoning_effort。</summary>
    DeepSeek,
    /// <summary>任意 OpenAI 兼容服务：用户自填 base url / key / model（OpenAI、通义、Kimi、vLLM、Ollama…）。</summary>
    OpenAiCompatible,
}

/// <summary>
/// 解析后的 AI 接入配置。
///
/// 为什么要集中解析：这段逻辑原先在 5 个调用点各抄了一遍（AiProxyService / ConversationService /
/// SystemAgentService / WikiGeneratorService ×2），于是默认模型名漂移出了 ``deepseek-chat``
/// 这种早已不在官方列表里的值，URL 也各拼各的。
/// </summary>
public sealed record AiOptions(
    AiProvider Provider,
    string BaseUrl,
    string ApiKey,
    string Model,
    bool Thinking,
    string ReasoningEffort,
    double Temperature,
    int MaxTokens,
    int RequestTimeoutSeconds)
{
    public const string DeepSeekDefaultBaseUrl = "https://api.deepseek.com";

    /// <summary>凭据齐了没有</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ApiKey) &&
        !string.IsNullOrWhiteSpace(BaseUrl) &&
        !string.IsNullOrWhiteSpace(Model);

    /// <summary>
    /// base url + 路径。**不做 /v1 增删**：DeepSeek 官方文档给的 base 是
    /// ``https://api.deepseek.com``（curl 示例直接打 ``/chat/completions``），
    /// 而 OpenAI 与多数兼容服务的 base 自带 ``/v1``。按用户填的原样拼，两边都对。
    /// </summary>
    public static string EndpointFor(string baseUrl, string path) => baseUrl.TrimEnd('/') + path;

    private string Url(string path) => EndpointFor(BaseUrl, path);

    public string ChatEndpoint => Url("/chat/completions");
    public string ModelsEndpoint => Url("/models");

    /// <summary>文档给出的 effort 取值；medium/minimal 是历史别名，会被服务端映射</summary>
    public static readonly string[] EffortLevels = ["none", "low", "high", "max"];
}
