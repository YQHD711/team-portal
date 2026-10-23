using System.Security.Claims;
using System.Text.Json;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// AI 运维助手接口（仅 admin）。全部只读：没有重建/编译/重启、没有代码提案。
/// 端点文件整体替换成只读工具后，暴露面就是这四个端点。
/// </summary>
public static class SystemAgentEndpoints
{
    private static readonly SemaphoreSlim _agentLock = new(1, 1);
    private static volatile bool _agentBusy = false;

    /// <summary>标准 SSE 帧：event 指定事件名，data 为 JSON（前端按事件名分发）。</summary>
    private static string Sse(string eventName, object data)
        => $"event: {eventName}\ndata: {JsonSerializer.Serialize(data)}\n\n";

    public static void MapSystemAgentEndpoints(this WebApplication app)
    {
        var agent = app.MapGroup("/api/admin/agent").RequireAuthorization("AdminOnly");

        // Run AI analysis — single-threaded to prevent concurrent tool execution conflicts
        agent.MapPost("/analyze", async (AgentRequest req, ClaimsPrincipal user, SystemAgentService svc, ConversationService conv) =>
        {
            if (_agentBusy || !await _agentLock.WaitAsync(0))
                return Results.Problem("AI 管理员正在处理上一个任务，请等待完成后重试", statusCode: 429);

            _agentBusy = true;
            try
            {
                var username = user.FindFirstValue(ClaimTypes.Name) ?? "admin";
                const string sessionId = "admin-agent";

                var history = await conv.GetContext(sessionId);
                var historyTuples = history.Select(m => (m.Role, m.Content)).ToList();

                await conv.AddMessage(sessionId, username, "user", req.Task);

                var result = await svc.RunAgent(req.Task, username, historyTuples);

                if (!string.IsNullOrWhiteSpace(result))
                    await conv.AddMessage(sessionId, username, "assistant", result);

                var stats = await conv.GetSessionStats(sessionId);
                return Results.Ok(new { result, sessionId, stats });
            }
            finally
            {
                _agentBusy = false;
                _agentLock.Release();
            }
        });

        // task-13：流式分析 —— SSE（text/event-stream）。
        // 工具轮非流式（与主聊天一致），最终作答 stream:true 把 provider SSE 原样转发；
        // 期间 event:status 推进度，结束 event:done（含 memory stats），失败 event:error。
        // 与 /analyze 共用同一把锁：流式任务未结束时另一个请求仍返回 429。
        agent.MapPost("/analyze/stream", async (AgentRequest req, ClaimsPrincipal user, SystemAgentService svc,
            ConversationService conv, HttpContext ctx) =>
        {
            if (_agentBusy || !await _agentLock.WaitAsync(0))
                return Results.Problem("AI 管理员正在处理上一个任务，请等待完成后重试", statusCode: 429);

            _agentBusy = true;
            var ct = ctx.RequestAborted;
            var started = false;

            async Task Send(string frame)
            {
                await ctx.Response.WriteAsync(frame, ct);
                await ctx.Response.Body.FlushAsync(ct); // 每帧立即下发，前端才能"边收边渲染"
            }

            try
            {
                var username = user.FindFirstValue(ClaimTypes.Name) ?? "admin";
                const string sessionId = "admin-agent";

                var history = await conv.GetContext(sessionId);
                var historyTuples = history.Select(m => (m.Role, m.Content)).ToList();
                await conv.AddMessage(sessionId, username, "user", req.Task);

                ctx.Response.StatusCode = StatusCodes.Status200OK;
                ctx.Response.ContentType = "text/event-stream; charset=utf-8";
                ctx.Response.Headers["Cache-Control"] = "no-cache";
                ctx.Response.Headers["X-Accel-Buffering"] = "no"; // 反代不缓冲，否则流式会整段到达
                started = true;

                var result = await svc.RunAgentStream(req.Task, username, historyTuples, Send, ct);

                if (!string.IsNullOrWhiteSpace(result.Answer))
                    await conv.AddMessage(sessionId, username, "assistant", result.Answer);
                var stats = await conv.GetSessionStats(sessionId);
                if (result.Error is not null)
                    await Send(Sse("error", new { message = result.Error }));
                await Send(Sse("done", new { stats, iterations = result.Iterations, toolCalls = result.ToolCalls }));
                return Results.Empty;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return Results.Empty; // 客户端断开：RunAgentStream 已取消上游请求
            }
            catch (Exception ex)
            {
                if (!started)
                    return Results.Problem("AI 分析启动失败：" + ex.Message, statusCode: 500);
                try { await Send(Sse("error", new { message = "❌ 分析失败: " + ex.Message })); } catch { /* 连接已断 */ }
                return Results.Empty;
            }
            finally
            {
                _agentBusy = false;
                _agentLock.Release();
            }
        });

        // Check agent status
        agent.MapGet("/status", () => Results.Ok(new { busy = _agentBusy }));

        // 可用工具清单 — 与提示词同源（SystemAgentService.BuildTools），供界面展示"这个助手能看什么"
        agent.MapGet("/tools", () => Results.Ok(SystemAgentService.BuildTools()
            .Select(t => new { t.Name, t.Description })));

        // 管理员操作手册目录与全文（界面侧边说明用）
        agent.MapGet("/guide", () => Results.Ok(SystemAgentService.GuideTopics()
            .Select(t => new { topic = t.Topic, content = t.Body })));

        // Get AI Admin memory stats
        agent.MapGet("/memory", async (ConversationService conv) => Results.Ok(await conv.GetSessionStats("admin-agent")));

        // Clear AI Admin memory
        agent.MapPost("/memory/clear", async (ConversationService conv) =>
        {
            await conv.DeleteSession("admin-agent");
            return Results.Ok(new { success = true });
        });
    }
}

public record AgentRequest(
    [property: System.Text.Json.Serialization.JsonPropertyName("task")] string Task,
    [property: System.Text.Json.Serialization.JsonPropertyName("sessionId")] string? SessionId
);
