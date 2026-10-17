using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using TeamPortal.Services;

namespace api;

/// <summary>
/// <see cref="AiToolCaller"/> 三个**可选**能力（默认关闭）的测试，防止 Wiki 收编时踩回原来的坑：
///  - `echoReasoningContent`：DeepSeek 思考模式要求每轮回传 `reasoning_content`；只在 DeepSeek + 显式开启时回放
///  - `toolResultMaxChars`：工具结果截断并留 `…[truncated]` 标记（不静默截）
///  - `maxIterations` / `timeoutError`：Wiki 需要 50 轮并保持原「timed out」错误语义
/// </summary>
public class AiToolCallerAdvancedTests
{
    private sealed class Handler(params string[] bodies) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];
        private int _i;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));
            var body = bodies[Math.Min(_i, bodies.Length - 1)];
            _i++;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static AiToolCaller Caller(HttpMessageHandler h)
        => new(new AiClient(new HttpClient(h), new ConfigurationBuilder().Build(), null!));

    private static AiOptions Opt(bool deepseek) => new(
        Provider: deepseek ? AiProvider.DeepSeek : AiProvider.OpenAiCompatible,
        BaseUrl: "https://mock.example/v1", ApiKey: "k", Model: "m", Thinking: deepseek,
        ReasoningEffort: "high", Temperature: 0.3, MaxTokens: 512, RequestTimeoutSeconds: 30);

    private static string ToolCallWithReasoning(string reasoning) => JsonSerializer.Serialize(new
    {
        choices = new[]
        {
            new
            {
                message = new
                {
                    role = "assistant", content = (string?)null, reasoning_content = reasoning,
                    tool_calls = new[] { new { id = "c1", type = "function", function = new { name = "list_files", arguments = "{}" } } },
                },
            },
        },
    });

    private static string Final(string content) => JsonSerializer.Serialize(new
    {
        choices = new[] { new { message = new { role = "assistant", content } } },
    });

    private static List<Dictionary<string, object?>> Msg()
        => [new Dictionary<string, object?> { ["role"] = "user", ["content"] = "hi" }];

    [Fact]
    public async Task ReasoningContent_IsReplayed_WhenEnabled_ForDeepSeek()
    {
        var handler = new Handler(ToolCallWithReasoning("先想想目录结构"), Final("done"));
        var result = await Caller(handler).RunAsync(Opt(deepseek: true), Msg(), null,
            (_, _) => Task.FromResult("{}"), echoReasoningContent: true);

        Assert.True(result.Ok);
        Assert.Equal(2, handler.Bodies.Count);
        Assert.Contains("先想想目录结构", handler.Bodies[1]);   // ← 第二轮请求必须带上
    }

    [Fact]
    public async Task ReasoningContent_NotReplayed_ByDefault()
    {
        var handler = new Handler(ToolCallWithReasoning("secret-thought"), Final("done"));
        await Caller(handler).RunAsync(Opt(deepseek: true), Msg(), null, (_, _) => Task.FromResult("{}"));

        Assert.DoesNotContain("secret-thought", handler.Bodies[1]);
    }

    [Fact]
    public async Task ReasoningContent_NotReplayed_ForOpenAi_EvenIfEnabled()
    {
        // 严格 OpenAI 兼容服务对未知 assistant 字段可能 400 → 即使显式开启也不回放
        var handler = new Handler(ToolCallWithReasoning("deepseek-only-thought"), Final("done"));
        await Caller(handler).RunAsync(Opt(deepseek: false), Msg(), null,
            (_, _) => Task.FromResult("{}"), echoReasoningContent: true);

        Assert.DoesNotContain("deepseek-only-thought", handler.Bodies[1]);
    }

    [Fact]
    public async Task ToolResult_Truncated_WithMarker()
    {
        var handler = new Handler(ToolCallWithReasoning("r"), Final("done"));
        var longResult = new string('x', 100);

        await Caller(handler).RunAsync(Opt(deepseek: false), Msg(), null,
            (_, _) => Task.FromResult(longResult), toolResultMaxChars: 10);

        Assert.Contains("…[truncated]", handler.Bodies[1]);
        Assert.DoesNotContain(new string('x', 20), handler.Bodies[1]);
    }

    [Fact]
    public async Task MaxIterations_Configurable_AndCustomTimeoutError()
    {
        var handler = new Handler(ToolCallWithReasoning("r"));   // 永远只返回 tool_calls
        var result = await Caller(handler).RunAsync(Opt(deepseek: false), Msg(), null,
            (_, _) => Task.FromResult("{}"), maxIterations: 3, timeoutError: "AI agent timed out after 60 minutes");

        Assert.False(result.Ok);
        Assert.Equal(3, result.Iterations);
        Assert.Equal(3, handler.Bodies.Count);
        Assert.Equal("AI agent timed out after 60 minutes", result.Error);
    }
}
