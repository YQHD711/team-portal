using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using TeamPortal.Services;

namespace api;

/// <summary>
/// Provider 专有字段的收敛测试（拆自 <see cref="AiToolCallerTests"/>，避免单文件超 200 行）：
/// DeepSeek 专有字段（`thinking` / `reasoning_effort`）**只在 `Provider=DeepSeek` 时下发** ——
/// 发给通用 OpenAI 兼容服务会直接 400，所以这条必须钉死。
/// </summary>
public class AiToolCallerProviderTests
{
    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new { choices = new[] { new { message = new { role = "assistant", content = "ok" } } } }),
                    Encoding.UTF8, "application/json"),
            };
        }
    }

    private static AiToolCaller Caller(RecordingHandler handler)
        => new(new AiClient(new HttpClient(handler), new ConfigurationBuilder().Build(), null!));

    private static AiOptions Opt(bool deepseek) => new(
        Provider: deepseek ? AiProvider.DeepSeek : AiProvider.OpenAiCompatible,
        BaseUrl: "https://mock.example/v1", ApiKey: "sk-test-123", Model: "test-model",
        Thinking: deepseek, ReasoningEffort: "high", Temperature: 0.3, MaxTokens: 1024, RequestTimeoutSeconds: 30);

    private static List<Dictionary<string, object?>> Msg()
        => [new Dictionary<string, object?> { ["role"] = "user", ["content"] = "hi" }];

    [Fact]
    public async Task OpenAiProvider_DoesNotSendDeepSeekOnlyFields()
    {
        var handler = new RecordingHandler();

        await Caller(handler).RunAsync(Opt(deepseek: false), Msg(), null, (_, _) => Task.FromResult("{}"));

        var body = Assert.Single(handler.Bodies);
        Assert.DoesNotContain("thinking", body);
        Assert.DoesNotContain("reasoning_effort", body);
    }

    [Fact]
    public async Task DeepSeekProvider_DoesSendDeepSeekOnlyFields()
    {
        var handler = new RecordingHandler();

        await Caller(handler).RunAsync(Opt(deepseek: true), Msg(), null, (_, _) => Task.FromResult("{}"));

        var body = Assert.Single(handler.Bodies);
        Assert.Contains("thinking", body);
        Assert.Contains("reasoning_effort", body);
    }
}
