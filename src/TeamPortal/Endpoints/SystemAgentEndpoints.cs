using System.Security.Claims;
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
