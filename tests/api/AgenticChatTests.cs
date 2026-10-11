using System.Text.Json;
using TeamPortal.Services;

namespace api;

/// <summary>task-16：工具循环的行为（夹具见 <see cref="AgenticChatTestBase"/>，测试全程不调真 AI）。</summary>
public class AgenticChatTests : AgenticChatTestBase
{
    [Fact]
    public async Task SearchTool_ResultGoesIntoNextRound_AndFinalRoundStreams()
    {
        Handler.Enqueue(ToolCall("call_1", "search_knowledge", SearchArgs()));
        Handler.Enqueue(Answer());
        Handler.EnqueueRaw(Sse);

        var stream = await Proxy.ChatStream("2025 年航协年终总结讲了什么", new AiProxyService.SearchScope("admin", null, 1));
        Assert.NotNull(stream);
        Assert.Equal(3, Handler.Bodies.Count);

        Assert.False(IsStream(Handler.Bodies[0]));                       // 工具轮：非流式
        Assert.True(Has(Handler.Bodies[0], "tools"));                    // 带工具

        // 第二轮：assistant 的 content/reasoning_content 必须完整回传（V4 否则 400），tool 结果也在
        var round2 = Messages(Handler.Bodies[1]);
        Assert.Contains(round2, m => m.Role == "tool" && m.Content.Contains("2025年航协年终总结.md"));
        Assert.Contains(round2, m => m.Role == "tool" && m.Content.Contains("训练"));
        Assert.Contains(round2, m => m.Role == "assistant" && m.Content == "我再看一眼");
        Assert.Contains("reasoning_content", Handler.Bodies[1]);          // 思考内容也回传了

        Assert.True(IsStream(Handler.Bodies[2]));                        // 最后一轮：流式
        Assert.False(Has(Handler.Bodies[2], "tools"));                   // 且不带工具

        using var reader = new StreamReader(stream!);
        Assert.Contains("最终回答", await reader.ReadToEndAsync());

        // 可观测性：工具轮统计进了 RagLog（Category=ai），且不含正文
        var line = await WaitForLogAsync(RagLog.ToolsPrefix);
        Assert.Contains("rounds=2", line);
        Assert.Contains("calls=1", line);
        Assert.Contains("search_knowledge×1", line);
    }

    [Fact]
    public async Task NoToolCall_OnlyAddsOneExtraRound()
    {
        Handler.Enqueue(Answer("直接回答"));
        Handler.EnqueueRaw(Sse);

        var stream = await Proxy.ChatStream("你好", new AiProxyService.SearchScope("admin", null, 1));

        Assert.NotNull(stream);
        Assert.Equal(2, Handler.Bodies.Count);   // 一轮工具请求 + 一轮流式，行为与改造前基本一致
        Assert.False(IsStream(Handler.Bodies[0]));
        Assert.True(IsStream(Handler.Bodies[1]));
        Assert.False(Has(Handler.Bodies[1], "tools"));
    }

    [Fact]
    public async Task RoundCap_StopsAndForcesAnswer()
    {
        Seed("AI:MaxToolRounds", "2");
        Settings.ClearCache();
        for (var i = 0; i < 3; i++)
            Handler.Enqueue(ToolCall($"call_{i}", "search_knowledge", SearchArgs($"第{i}次检索")));
        Handler.EnqueueRaw(Sse);

        var stream = await Proxy.ChatStream("反复检索吧", new AiProxyService.SearchScope("admin", null, 1));

        Assert.NotNull(stream);
        Assert.Equal(3, Handler.Bodies.Count);                              // 2 轮工具 + 1 轮流式
        Assert.Equal(2, Handler.Bodies.Count(b => Has(b, "tools")));        // 工具轮严格是 2
        Assert.Contains(Messages(Handler.Bodies[2]), m => m.Content.Contains("已达到本轮检索次数上限"));
        var line = await WaitForLogAsync(RagLog.ToolsPrefix);
        Assert.Contains("rounds=2", line);
        Assert.Contains("calls=2", line);
    }

    [Fact]
    public async Task PerRoundCallCap_ExecutesThree_ButAnswersEveryCall()
    {
        var many = JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content = "多调几个",
                        tool_calls = Enumerable.Range(1, 5).Select(i => new
                        {
                            id = $"c{i}", type = "function",
                            function = new { name = "search_knowledge", arguments = SearchArgs($"查询{i}") },
                        }).ToArray(),
                    }
                }
            }
        });
        Handler.Enqueue(many);
        Handler.Enqueue(Answer());
        Handler.EnqueueRaw(Sse);

        await Proxy.ChatStream("一次调五个", new AiProxyService.SearchScope("admin", null, 1));

        var round2 = Messages(Handler.Bodies[1]).Where(m => m.Role == "tool").ToList();
        Assert.Equal(5, round2.Count);                                    // 每个 tool_call 都要有响应
        Assert.Equal(2, round2.Count(m => m.Content.Contains("单轮工具调用已达上限")));
        var line = await WaitForLogAsync(RagLog.ToolsPrefix);
        Assert.Contains("calls=3", line);                                 // 实际只执行 3 个
    }

    [Fact]
    public async Task ToolRoundFailure_FallsBackToStreamingAnswer()
    {
        Handler.EnqueueStatus(System.Net.HttpStatusCode.InternalServerError, "{\"error\":\"boom\"}");
        Handler.EnqueueRaw(Sse);

        var stream = await Proxy.ChatStream("上游坏了", new AiProxyService.SearchScope("admin", null, 1));

        Assert.NotNull(stream);
        Assert.Equal(2, Handler.Bodies.Count);
        using var reader = new StreamReader(stream!);
        Assert.Contains("最终回答", await reader.ReadToEndAsync());
    }

    [Fact]
    public async Task MalformedToolRound_FallsBackToStreamingAnswer()
    {
        Handler.EnqueueRaw("这不是 JSON");                                 // 例如上游返回了 SSE/垃圾
        Handler.EnqueueRaw(Sse);

        var stream = await Proxy.ChatStream("垃圾响应", new AiProxyService.SearchScope("admin", null, 1));

        Assert.NotNull(stream);
        Assert.Equal(2, Handler.Bodies.Count);
    }

    [Fact]
    public async Task ToolLoopBudget_StopsToolRounds()
    {
        // 墙钟兜底：预算设 0 → 一次工具轮都不跑，直接流式作答（防止多轮请求把交互拖太久）
        Proxy.ToolLoopBudgetMs = 0;
        Handler.Enqueue(ToolCall("call_1", "search_knowledge", SearchArgs()));
        Handler.EnqueueRaw(Sse);

        var stream = await Proxy.ChatStream("预算为零", new AiProxyService.SearchScope("admin", null, 1));

        Assert.NotNull(stream);
        Assert.Single(Handler.Bodies);
        Assert.True(IsStream(Handler.Bodies[0]));
    }
}
