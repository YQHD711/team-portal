using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using TeamPortal.Services;

namespace api;

/// <summary>
/// <see cref="AiToolCaller"/> 的请求形状测试（mock OpenAI 兼容端点，不连真网）：
///  - 第一次请求：`POST {base}/chat/completions`、`Authorization: Bearer &lt;key&gt;`、`messages` 数组、`tools` 存在
///  - 返回 tool_calls → 第二次请求含 `role:"tool"` + `tool_call_id`，且回放了 assistant 的 tool_calls
///  - `Provider=OpenAI` 时 body **不含** DeepSeek 专有字段；`Provider=DeepSeek` 时**含**
///  - 一直返回 tool_calls → 第 8 轮后停下并给可读错误
/// </summary>
public class AiToolCallerTests
{
    private sealed class RecordingHandler(params (HttpStatusCode Status, string Body)[] responses) : HttpMessageHandler
    {
        public List<(string Method, string Uri, string? Auth, string Body)> Requests { get; } = [];
        private int _i;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add((request.Method.Method, request.RequestUri!.ToString(),
                request.Headers.TryGetValues("Authorization", out var v) ? string.Join("", v) : null, body));
            var (status, respBody) = responses[Math.Min(_i, responses.Length - 1)];
            _i++;
            return new HttpResponseMessage(status) { Content = new StringContent(respBody, Encoding.UTF8, "application/json") };
        }
    }

    private static AiClient NewClient(HttpMessageHandler handler, string baseUrl = "https://mock.example/v1")
        => new(new HttpClient(handler), new ConfigurationBuilder().Build(), null!);

    private static AiOptions Opt(bool deepseek) => new(
        Provider: deepseek ? AiProvider.DeepSeek : AiProvider.OpenAiCompatible,
        BaseUrl: "https://mock.example/v1", ApiKey: "sk-test-123", Model: "test-model",
        Thinking: deepseek, ReasoningEffort: "high", Temperature: 0.3, MaxTokens: 1024, RequestTimeoutSeconds: 30);

    private static string ContentResp(string content) => JsonSerializer.Serialize(new
    {
        choices = new[] { new { message = new { role = "assistant", content } } },
    });

    private static string ToolCallResp(string id, string name, string args) => JsonSerializer.Serialize(new
    {
        choices = new[]
        {
            new
            {
                message = new
                {
                    role = "assistant", content = (string?)null,
                    tool_calls = new[]
                    {
                        new { id, type = "function", function = new { name, arguments = args } },
                    },
                },
            },
        },
    });

    private static List<object> Tools() =>
    [
        new
        {
            type = "function",
            function = new
            {
                name = "list_files",
                description = "列出目录",
                parameters = new { type = "object", properties = new { path = new { type = "string" } } },
            },
        },
    ];

    [Fact]
    public async Task FirstRequest_HasOpenAiShape_AndSecondRoundCarriesToolResult()
    {
        var handler = new RecordingHandler(
            (HttpStatusCode.OK, ToolCallResp("call-1", "list_files", """{"path":"src"}""")),
            (HttpStatusCode.OK, ContentResp("完成")));
        var caller = new AiToolCaller(NewClient(handler));
        var messages = new List<Dictionary<string, object?>> { new() { ["role"] = "user", ["content"] = "看看目录" } };
        var executed = new List<(string Name, string Args)>();

        var result = await caller.RunAsync(Opt(deepseek: false), messages, Tools(),
            (name, args) => { executed.Add((name, args)); return Task.FromResult("""{"files":["a.cs"]}"""); });

        Assert.True(result.Ok);
        Assert.Equal("完成", result.Content);
        Assert.Equal(2, result.Iterations);
        Assert.Single(executed);
        Assert.Equal("list_files", executed[0].Name);
        Assert.Equal("""{"path":"src"}""", executed[0].Args);

        // 第一次请求形状
        Assert.Equal(2, handler.Requests.Count);
        var first = handler.Requests[0];
        Assert.Equal("POST", first.Method);
        Assert.EndsWith("/chat/completions", first.Uri);
        Assert.Equal("Bearer sk-test-123", first.Auth);
        using var firstDoc = JsonDocument.Parse(first.Body);
        Assert.True(firstDoc.RootElement.TryGetProperty("messages", out var msgs));
        Assert.Equal(JsonValueKind.Array, msgs.ValueKind);
        Assert.True(firstDoc.RootElement.TryGetProperty("tools", out _));

        // 第二次请求：assistant 的 tool_calls 回放 + role:"tool" 结果
        using var secondDoc = JsonDocument.Parse(handler.Requests[1].Body);
        var second = secondDoc.RootElement.GetProperty("messages");
        var all = second.EnumerateArray().ToArray();
        Assert.Contains(all, m => m.TryGetProperty("role", out var r) && r.GetString() == "assistant"
                                  && m.TryGetProperty("tool_calls", out _));
        var tool = all.First(m => m.TryGetProperty("role", out var r) && r.GetString() == "tool");
        Assert.Equal("call-1", tool.GetProperty("tool_call_id").GetString());
        Assert.Contains("a.cs", tool.GetProperty("content").GetString());
    }

    [Fact]
    public async Task EndlessToolCalls_StopAtMaxIterations_WithReadableError()
    {
        var handler = new RecordingHandler((HttpStatusCode.OK, ToolCallResp("call-x", "list_files", "{}")));
        var caller = new AiToolCaller(NewClient(handler));

        var result = await caller.RunAsync(Opt(deepseek: false),
            [new Dictionary<string, object?> { ["role"] = "user", ["content"] = "loop" }], Tools(),
            (_, _) => Task.FromResult("{}"));

        Assert.False(result.Ok);
        Assert.Equal(AiToolCaller.MaxIterations, result.Iterations);
        Assert.Contains("超过", result.Error);
        Assert.Equal(AiToolCaller.MaxIterations, handler.Requests.Count);
    }

    [Fact]
    public async Task HttpError_ReturnsReadableError_NotEmptySuccess()
    {
        var handler = new RecordingHandler((HttpStatusCode.BadRequest, """{"error":{"message":"bad tools"}}"""));
        var caller = new AiToolCaller(NewClient(handler));

        var result = await caller.RunAsync(Opt(deepseek: false),
            [new Dictionary<string, object?> { ["role"] = "user", ["content"] = "hi" }], Tools(),
            (_, _) => Task.FromResult("{}"));

        Assert.False(result.Ok);
        Assert.Contains("HTTP 400", result.Error);
    }

    [Fact]
    public async Task NoToolCalls_ReturnsContentInOneRound()
    {
        var handler = new RecordingHandler((HttpStatusCode.OK, ContentResp("直接回答")));
        var caller = new AiToolCaller(NewClient(handler));

        var result = await caller.RunAsync(Opt(deepseek: false),
            [new Dictionary<string, object?> { ["role"] = "user", ["content"] = "hi" }], null,
            (_, _) => Task.FromResult("{}"));

        Assert.True(result.Ok);
        Assert.Equal("直接回答", result.Content);
        Assert.Equal(1, result.Iterations);
    }
}
