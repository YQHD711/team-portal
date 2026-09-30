using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using TeamPortal.Services;

namespace api;

/// <summary>
/// AI 接入层：按 DeepSeek 官方文档决定请求体该带哪些参数。
///
/// 回归的原始缺陷：关闭思考用的是 ``extra_body: { thinking_mode: "non-thinking" }``。
/// ``extra_body`` 是 OpenAI **Python SDK** 的包装概念，原生 HTTP 里不存在这个字段，
/// ``thinking_mode`` 也不是官方参数名 —— 服务端直接忽略，**思考模式其实一直开着**：
/// 用户在 AI 回答前经历长时间无输出（reasoning 增量被前端丢弃），费用也偏高。
/// </summary>
public class AiClientTests
{
    private static AiClient Client(HttpMessageHandler? handler = null)
    {
        var http = handler is null ? new HttpClient() : new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        return new AiClient(http, config, null!);
    }

    private static AiOptions Opts(
        AiProvider provider = AiProvider.DeepSeek, bool thinking = false,
        string baseUrl = "https://api.deepseek.com", string model = "deepseek-flash", string effort = "high")
        => new(provider, baseUrl, "sk-test", model, thinking, effort, 0.7, 8192, 300);

    private static Dictionary<string, object?> Payload(AiOptions o, bool stream = false)
        => Client().BuildChatPayload(o, [new { role = "user", content = "hi" }], stream);

    // ── 端点拼装：按官方文档不做 /v1 增删 ──

    [Theory]
    [InlineData("https://api.deepseek.com", "https://api.deepseek.com/chat/completions")]
    [InlineData("https://api.deepseek.com/", "https://api.deepseek.com/chat/completions")]
    [InlineData("https://api.deepseek.com/v1", "https://api.deepseek.com/v1/chat/completions")]
    [InlineData("https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions")]
    [InlineData("http://localhost:11434/v1", "http://localhost:11434/v1/chat/completions")]
    public void ChatEndpoint_RespectsWhatTheUserTyped(string baseUrl, string expected)
        => Assert.Equal(expected, Opts(baseUrl: baseUrl).ChatEndpoint);

    // ── 请求体：只发当前模式下真正生效的参数 ──

    [Fact]
    public void NonThinking_DeepSeek_DisablesThinkingAndSendsTemperature()
    {
        var p = Payload(Opts(thinking: false));

        Assert.Equal("disabled", ((dynamic)p["thinking"]!).type);
        Assert.True(p.ContainsKey("temperature"));
        Assert.False(p.ContainsKey("top_p"));              // 非思考模式下 top_p 被服务端忽略
        Assert.False(p.ContainsKey("reasoning_effort"));
    }

    [Fact]
    public void Thinking_DeepSeek_EnablesThinkingAndSendsTopPNotTemperature()
    {
        var p = Payload(Opts(thinking: true, effort: "max"));

        Assert.Equal("enabled", ((dynamic)p["thinking"]!).type);
        Assert.Equal("max", p["reasoning_effort"]);
        Assert.Equal(1.0, p["top_p"]);
        Assert.False(p.ContainsKey("temperature"));        // 思考模式下 temperature 无效
    }

    [Fact]
    public void OpenAiCompatible_NeverSendsDeepSeekOnlyParams()
    {
        // 通用 OpenAI 兼容服务不认识 thinking；带上可能直接 400
        foreach (var thinking in new[] { true, false })
        {
            var p = Payload(Opts(AiProvider.OpenAiCompatible, thinking));
            Assert.False(p.ContainsKey("thinking"));
            Assert.False(p.ContainsKey("reasoning_effort"));
        }
    }

    [Fact]
    public void Payload_NeverContainsExtraBodyOrDeprecatedPenalties()
    {
        foreach (var provider in new[] { AiProvider.DeepSeek, AiProvider.OpenAiCompatible })
            foreach (var thinking in new[] { true, false })
            {
                var p = Payload(Opts(provider, thinking));
                // extra_body 不是原生 HTTP 字段（那是 OpenAI Python SDK 的包装）
                Assert.False(p.ContainsKey("extra_body"));
                // 官方已标记 deprecated，传了也不生效
                Assert.False(p.ContainsKey("frequency_penalty"));
                Assert.False(p.ContainsKey("presence_penalty"));
                Assert.False(p.ContainsKey("thinking_mode"));
            }
    }

    [Fact]
    public void Stream_RequestsUsageOnLastChunk()
    {
        var p = Payload(Opts(), stream: true);
        Assert.True(p.ContainsKey("stream_options"));
        Assert.Equal(true, p["stream"]);
    }

    [Fact]
    public void Tools_DefaultToAutoChoice()
    {
        // 文档：思考模式下 required / 具名 tool_choice 会 400，auto 可用
        var o = Opts(thinking: true);
        var p = Client().BuildChatPayload(o, [new { role = "user", content = "x" }], false, tools: new[] { new { type = "function" } });

        Assert.Equal("auto", p["tool_choice"]);
    }

    // ── effort 归一（medium/minimal 是历史别名）──

    [Theory]
    [InlineData(null, "high")]
    [InlineData("", "high")]
    [InlineData("medium", "high")]
    [InlineData("xhigh", "high")]
    [InlineData("迷你", "high")]
    [InlineData("minimal", "low")]
    [InlineData("low", "low")]
    [InlineData("HIGH", "high")]
    [InlineData("none", "none")]
    [InlineData("max", "max")]
    public void NormalizeEffort_MapsLegacyAliases(string? raw, string expected)
        => Assert.Equal(expected, AiClient.NormalizeEffort(raw));

    // ── 响应解析：思考模型的 reasoning_content 不进正文 ──

    [Fact]
    public void ExtractMessageContent_IgnoresReasoningContent()
    {
        using var doc = JsonDocument.Parse("""
            {"choices":[{"message":{"role":"assistant","content":"答案","reasoning_content":"一大段思考"}}]}
            """);
        Assert.Equal("答案", AiClient.ExtractMessageContent(doc.RootElement));
    }

    [Fact]
    public void ExtractDeltaContent_IgnoresReasoningDelta()
    {
        using var reason = JsonDocument.Parse("""{"choices":[{"delta":{"reasoning_content":"想…"}}]}""");
        using var answer = JsonDocument.Parse("""{"choices":[{"delta":{"content":"好"}}]}""");

        Assert.Null(AiClient.ExtractDeltaContent(reason.RootElement));
        Assert.Equal("好", AiClient.ExtractDeltaContent(answer.RootElement));
    }

    // ── 模型列表：DeepSeek 的富字段与通用服务的最小字段都要能解析 ──

    private sealed class StubHandler(string body, HttpStatusCode code = HttpStatusCode.OK) : HttpMessageHandler
    {
        public string? LastUrl;
        public string? LastAuth;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastUrl = request.RequestUri?.ToString();
            LastAuth = request.Headers.Authorization?.ToString();
            return Task.FromResult(new HttpResponseMessage(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task ListModels_ParsesDeepSeekRichMetadata()
    {
        var handler = new StubHandler("""
            {"object":"list","data":[
              {"id":"deepseek-flash","object":"model","owned_by":"deepseek","name":"DeepSeek Flash",
               "context_window":1000000,"max_output_tokens":393216,
               "input_modalities":["text","image"],"output_modalities":["text"],
               "effort":{"supported_levels":["low","high","max"],"default_level":"high"}},
              {"id":"deepseek-v4-pro","object":"model","owned_by":"deepseek"}
            ]}
            """);
        var (ok, error, models) = await Client(handler).ListModelsAsync(Opts(baseUrl: "https://api.deepseek.com"));

        Assert.True(ok, error);
        Assert.Equal("https://api.deepseek.com/models", handler.LastUrl);
        Assert.Equal("Bearer sk-test", handler.LastAuth);
        Assert.Equal(2, models.Count);

        var flash = models.Single(m => m.Id == "deepseek-flash");
        Assert.Equal("DeepSeek Flash", flash.Name);
        Assert.Equal(1_000_000, flash.ContextWindow);
        Assert.Equal(393_216, flash.MaxOutputTokens);
        Assert.Equal(["low", "high", "max"], flash.EffortLevels);

        // 通用服务可能只给 id，缺的字段留空而不是编造
        var pro = models.Single(m => m.Id == "deepseek-v4-pro");
        Assert.Null(pro.ContextWindow);
        Assert.Empty(pro.EffortLevels);
    }

    [Fact]
    public async Task ListModels_OpenAiStyleMinimalPayload_Works()
    {
        var handler = new StubHandler("""
            {"object":"list","data":[{"id":"gpt-4o-mini","object":"model","owned_by":"openai"}]}
            """);
        var (ok, error, models) = await Client(handler).ListModelsAsync(
            Opts(AiProvider.OpenAiCompatible, baseUrl: "https://api.openai.com/v1"));

        Assert.True(ok, error);
        Assert.Equal("https://api.openai.com/v1/models", handler.LastUrl);
        Assert.Equal("gpt-4o-mini", Assert.Single(models).Id);
    }

    [Fact]
    public async Task ListModels_SurfacesServerErrorInsteadOfThrowing()
    {
        var handler = new StubHandler("""{"error":{"message":"Invalid API key"}}""", HttpStatusCode.Unauthorized);
        var (ok, error, models) = await Client(handler).ListModelsAsync(Opts());

        Assert.False(ok);
        Assert.Contains("401", error);
        Assert.Empty(models);
    }

    [Fact]
    public async Task ListModels_NoKey_ShortCircuits()
    {
        var handler = new StubHandler("{}");
        var (ok, error, _) = await Client(handler).ListModelsAsync(Opts() with { ApiKey = "" });

        Assert.False(ok);
        Assert.Contains("API Key", error);
        Assert.Null(handler.LastUrl); // 不该白跑一趟网络
    }
}
