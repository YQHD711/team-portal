using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace api;

/// <summary>
/// task-13：AI 系统管理员流式端点（POST /api/admin/agent/analyze/stream）。
///
/// 覆盖三件事：
///  1. 鉴权 —— 成员身份打该端点必须 403（与 /analyze 同属 AdminOnly）。
///  2. 转发 —— 工具轮仍是非流式带 tools；最终一轮 stream:true；provider 的 SSE 原样出现在响应里，
///     结束有 event:done（含 memory stats），正文落进 admin-agent 会话记忆。
///  3. provider 非 200 —— 不炸连接，转成 event:error + event:done。
/// </summary>
public class SystemAgentStreamTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public SystemAgentStreamTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task Admin_StreamsStatusThenProviderSse_AndSavesMemory()
    {
        var dbPath = AgentStreamTestSupport.NewDbPath();
        try
        {
            var handler = new AgentStreamTestSupport.ScriptedHandler();
            handler.Enqueue(AgentStreamTestSupport.ToolCall("call_1", "get_admin_guide", "{\"topic\":\"备份\"}"));
            handler.Enqueue(AgentStreamTestSupport.Answer("（这一轮的正文不展示，最终回答靠流式）"));
            handler.Enqueue(AgentStreamTestSupport.Sse, "text/event-stream");

            var client = AgentStreamTestSupport.Client(_factory, dbPath, handler);
            client.DefaultRequestHeaders.Authorization =
                new("Bearer", await AgentStreamTestSupport.LoginAsync(client, "boss", "pw123456"));

            var res = await client.PostAsJsonAsync("/api/admin/agent/analyze/stream", new { task = "检查一下备份" });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Contains("text/event-stream", res.Content.Headers.ContentType?.ToString() ?? "");

            var body = await res.Content.ReadAsStringAsync();
            Assert.Contains("event: status", body);          // 轮次/工具进度
            Assert.Contains("\"phase\":\"tool\"", body);
            Assert.Contains("get_admin_guide", body);         // 工具名要显示给前端
            Assert.Contains("最终回答", body);                // provider SSE 原样转发
            Assert.Contains("event: done", body);             // 结束事件
            Assert.Contains("\"stats\"", body);               // done 带 memory stats

            Assert.Equal(3, handler.Bodies.Count);
            Assert.False(AgentStreamTestSupport.IsStream(handler.Bodies[0]));      // 工具轮：非流式...
            Assert.True(AgentStreamTestSupport.Has(handler.Bodies[0], "tools"));   // ...且带 tools
            Assert.True(AgentStreamTestSupport.IsStream(handler.Bodies[2]));       // 最终作答：流式...
            Assert.False(AgentStreamTestSupport.Has(handler.Bodies[2], "tools"));  // ...且不带 tools

            await using var db = new AppDbContext(AgentStreamTestSupport.Options(dbPath));
            var saved = await db.ChatMessages
                .Where(m => m.SessionId == "admin-agent" && m.Role == "assistant")
                .OrderByDescending(m => m.Id).FirstOrDefaultAsync();
            Assert.NotNull(saved);
            Assert.Equal("最终回答", saved!.Content);         // 累计正文落进记忆，刷新页面还能看到
        }
        finally { AgentStreamTestSupport.Cleanup(dbPath); }
    }

    [Fact]
    public async Task Member_IsForbidden_AndProviderNeverCalled()
    {
        var dbPath = AgentStreamTestSupport.NewDbPath();
        try
        {
            var handler = new AgentStreamTestSupport.ScriptedHandler();
            var client = AgentStreamTestSupport.Client(_factory, dbPath, handler);
            await AgentStreamTestSupport.SeedMemberAsync(dbPath);
            client.DefaultRequestHeaders.Authorization =
                new("Bearer", await AgentStreamTestSupport.LoginAsync(client, "member1", "pw123456"));

            var res = await client.PostAsJsonAsync("/api/admin/agent/analyze/stream", new { task = "系统健康吗" });
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
            Assert.Empty(handler.Bodies);
        }
        finally { AgentStreamTestSupport.Cleanup(dbPath); }
    }

    [Fact]
    public async Task ProviderError_BecomesErrorEvent_ThenDone()
    {
        var dbPath = AgentStreamTestSupport.NewDbPath();
        try
        {
            var handler = new AgentStreamTestSupport.ScriptedHandler();
            handler.Enqueue(AgentStreamTestSupport.Answer()); // 工具轮：直接作答 → 进入流式阶段
            handler.FailAfterScript = true;                   // 最终流式请求（及弹性重试）一律 500

            var client = AgentStreamTestSupport.Client(_factory, dbPath, handler);
            client.DefaultRequestHeaders.Authorization =
                new("Bearer", await AgentStreamTestSupport.LoginAsync(client, "boss", "pw123456"));

            var res = await client.PostAsJsonAsync("/api/admin/agent/analyze/stream", new { task = "触发上游错误" });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);   // 已开始 SSE，不能再改 HTTP 状态码

            var body = await res.Content.ReadAsStringAsync();
            Assert.Contains("event: error", body);
            // provider 500 的错误文案会被 SSE JSON 转义（中文变 \uXXXX），断言状态码文本即可
            Assert.Contains("InternalServerError", body);
            Assert.Contains("event: done", body);
            Assert.Contains("event: done", body);
        }
        finally { AgentStreamTestSupport.Cleanup(dbPath); }
    }
}