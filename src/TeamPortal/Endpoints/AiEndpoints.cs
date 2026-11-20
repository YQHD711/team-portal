using System.Security.Claims;
using System.Text;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static partial class AiEndpoints
{
    /// <summary>把调用者身份传给 AI 检索层:知识库检索必须限定在其有权查看的范围内。
    /// 身份**查库取当前值** —— token 活 7 天且没有失效机制，读声明会把旧部门/旧角色带进检索范围。</summary>
    private static async Task<AiProxyService.SearchScope> GetScopeAsync(ClaimsPrincipal user, AppDbContext db)
    {
        var (role, dept, uid) = await CurrentUser.FromDbAsync(user, db);
        return new(role, dept, uid);
    }

    /// <summary>从累积的 SSE 文本里取出 assistant 正文（拼接每个 delta.content），与前端渲染口径一致。</summary>
    private static string ExtractAssistantText(string sseText) => SseTextExtractor.ExtractAssistantText(sseText);

    /// <summary>单调时钟耗时（毫秒），用于日志里的响应耗时。</summary>
    private static long ElapsedMs(long startedAt) => Environment.TickCount64 - startedAt;

    public static void MapAiEndpoints(this WebApplication app)
    {
        // ── 模型发现（管理员）：直接打服务商官方的 GET /models ──
        //
        // 为什么要它：模型名以前是硬编码的，官方一换名（deepseek-chat → deepseek-flash /
        // deepseek-v4-pro）配置就悄悄失效，而界面上看不出来。改成一键拉取现行列表，
        // 顺带把上下文长度、最大输出、思考档位这些元信息也显示出来。
        var admin = app.MapGroup("/api/admin/ai").RequireAuthorization("perm:admin.settings.manage");

        // 内置默认提示词：设置页要能看见它 —— 否则「留空 = 使用内置默认」就是一句
        // 无法核对的承诺，管理员改提示词时并不知道自己在覆盖什么。
        admin.MapGet("/default-prompt", () => Results.Ok(new { prompt = AiProxyService.DefaultSystemPrompt }));

        admin.MapGet("/models", async (AiClient ai) =>
        {
            var opt = await ai.ResolveAsync();
            var (ok, error, models) = await ai.ListModelsAsync(opt);
            return Results.Ok(new
            {
                ok,
                error,
                provider = opt.Provider == AiProvider.DeepSeek ? "deepseek" : "openai",
                baseUrl = opt.BaseUrl,
                currentModel = opt.Model,
                models,
            });
        });

        // 限流:AI 调用直接产生 DeepSeek 费用,必须挡住单账号刷量
        var group = app.MapGroup("/api/ai").RequireAuthorization().RequireRateLimiting("default");

        group.MapPost("/chat", async (ChatRequest req, ClaimsPrincipal user, AiProxyService proxy, ConversationService conv, LogService log, AppDbContext db, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Question))
                return Results.Problem("question 不能为空", statusCode: 400);
            var userName = user.FindFirstValue(ClaimTypes.Name) ?? "anonymous";
            var sessionId = req.SessionId ?? Guid.NewGuid().ToString("N")[..12];

            // Verify session ownership — if sessionId belongs to another user, start fresh
            if (!string.IsNullOrEmpty(req.SessionId) && !await conv.IsSessionOwner(sessionId, userName))
                sessionId = Guid.NewGuid().ToString("N")[..12];

            // Load conversation history
            var history = await conv.GetContext(sessionId, userName);
            var historyTuples = history.Select(m => (m.Role, m.Content)).ToList();

            // Save user message
            await conv.AddMessage(sessionId, userName, "user", req.Question);

            var startedAt = Environment.TickCount64;
            Stream? stream;
            try
            {
                // 传 RequestAborted：浏览器关页面/点停止时能同步取消上游 DeepSeek 请求
                stream = await proxy.ChatStream(req.Question, await GetScopeAsync(user, db), historyTuples, ctx.RequestAborted);
            }
            catch (Exception ex)
            {
                log.Warn("ai", $"Chat 启动失败: user={userName} session={sessionId}: {ex.GetType().Name}: {ex.Message}");
                return Results.Problem("AI 服务启动失败，请稍后重试", statusCode: 503);
            }

            if (stream is null)
            {
                // ChatStream 内部已按「未配置 / 首字节超时 / 上游报错 / 被取消」分别记过日志，
                // 这里只补一条面向调用方的结论，方便把前端报错和日志对上。
                log.Warn("ai", $"Chat failed: 上游不可用或超时, user={userName} session={sessionId}");
                return Results.Problem("AI 服务暂不可用（未配置密钥、上游超时或额度不足），请稍后重试", statusCode: 503);
            }

            // ── SSE 响应头：这一组缺一不可 ──
            // X-Accel-Buffering: no 是给 nginx 看的。不加它时 nginx 会把整个 SSE 响应
            // 缓冲完再一次性下发，前端就永远看不到"逐字出现"，表现得像非流式（线上就是这个现象）。
            // 必须由后端发：链路是 浏览器 → nginx → Next.js → 本服务，只改 nginx 容易漏一层。
            ctx.Response.ContentType = "text/event-stream; charset=utf-8";
            ctx.Response.Headers["Cache-Control"] = "no-cache, no-transform";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";
            ctx.Response.Headers["Connection"] = "keep-alive";
            ctx.Response.Headers["X-Chat-Session"] = sessionId;

            var assembled = new StringBuilder();
            var decoder = Encoding.UTF8.GetDecoder();   // 中文可能跨 chunk 边界，必须用 Decoder 增量解码
            var charBuffer = new char[Encoding.UTF8.GetMaxCharCount(8192)];
            var buffer = new byte[8192];
            var bytesRead = 0;
            var completed = false;

            try
            {
                // 先把响应头发出去：前端能立刻从「正在检索资料」切到「正在输出」，
                // 也避免前端把"首字节迟迟不到"误判成超时。
                await ctx.Response.StartAsync(ctx.RequestAborted);

                int read;
                while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ctx.RequestAborted)) > 0)
                {
                    bytesRead += read;
                    var charCount = decoder.GetChars(buffer, 0, read, charBuffer, 0);
                    assembled.Append(charBuffer, 0, charCount);

                    await ctx.Response.Body.WriteAsync(buffer.AsMemory(0, read), ctx.RequestAborted);
                    // 每块立刻 flush：SSE 的意义就在这里，攒着发等于没做流式。
                    await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
                }
                await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
                completed = true;
            }
            catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
            {
                // 用户关页面/点停止：正常场景，不记 Warn；已生成的部分仍然保存。
                log.Info("ai", $"Chat 被客户端中断: user={userName} session={sessionId} 已收 {bytesRead}B ({ElapsedMs(startedAt)}ms)");
            }
            catch (Exception ex)
            {
                // 流中途失败：必须给前端一个可识别的错误帧。
                // 否则前端只会看到流"无声结束"，界面上留下半截回答且没有任何提示。
                log.Warn("ai", $"Chat 流中断: user={userName} session={sessionId} 已收 {bytesRead}B: {ex.GetType().Name}: {ex.Message}");
                try
                {
                    var payload = System.Text.Json.JsonSerializer.Serialize(new { error = "AI 响应中断，请重试本问题" });
                    var frame = Encoding.UTF8.GetBytes($"event: error\ndata: {payload}\n\n");
                    await ctx.Response.Body.WriteAsync(frame, CancellationToken.None);
                    await ctx.Response.Body.FlushAsync(CancellationToken.None);
                }
                catch { /* 连接已断，写不进去属正常 */ }
            }
            finally
            {
                await stream.DisposeAsync();

                // 保存回答：取 SSE 里所有 delta.content 拼起来（与前端渲染口径一致）。
                var answer = ExtractAssistantText(assembled.ToString());
                if (!string.IsNullOrWhiteSpace(answer))
                {
                    try { await conv.AddMessage(sessionId, userName, "assistant", answer); }
                    catch (Exception ex) { log.Warn("ai", $"Chat 回答保存失败 session={sessionId}: {ex.Message}"); }
                }

                log.Info("ai", $"Chat {(completed ? "完成" : "未完成")}: user={userName} session={sessionId} {ElapsedMs(startedAt)}ms 收 {bytesRead}B 存 {answer.Length}字");
            }

            // 响应体已由上面手动写完，这里不再产出内容
            return Results.Empty;
        });

        group.MapPost("/search", async (SearchRequest req, ClaimsPrincipal user, AiProxyService proxy, LogService log, AppDbContext db) =>
        {
            var userName = user.FindFirstValue(ClaimTypes.Name) ?? "anonymous";
            var result = await proxy.Search(req.Query, await GetScopeAsync(user, db));
            if (result is null)
            {
                log.Warn("ai", $"Search failed: AI service unavailable, user={userName}");
                return Results.Problem("Search service unavailable", statusCode: 503);
            }

            log.Info("ai", $"Search: {userName} query={req.Query}");
            return Results.Ok(result);
        });

        // 聊天空会话的建议问题（task-14）—— 见 AiEndpoints.Suggestions.cs
        MapSuggestionEndpoints(group);
    }
}

public record ChatRequest(string Question, string? SessionId);
public record SearchRequest(string Query);

/// <summary>
/// SSE 文本提取：把累积的 SSE 响应里所有 delta.content 拼成最终回答。
///
/// 为什么要独立成类：端点既要边转发边累积（流式），又要落库完整回答（对话记忆）。
/// 解析口径必须与前端一致——只取 choices[0].delta.content，
/// 丢弃 reasoning_content（思考过程既不展示也不入库）。
/// </summary>
internal static class SseTextExtractor
{
    public static string ExtractAssistantText(string sseText)
    {
        if (string.IsNullOrEmpty(sseText)) return "";
        var sb = new StringBuilder();
        foreach (var rawLine in sseText.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            if (!line.StartsWith("data: ", StringComparison.Ordinal)) continue;
            var json = line[6..].Trim();
            if (json.Length == 0 || json == "[DONE]") continue;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0) continue;
                if (!choices[0].TryGetProperty("delta", out var delta)) continue;
                if (delta.TryGetProperty("content", out var content)
                    && content.ValueKind == System.Text.Json.JsonValueKind.String)
                    sb.Append(content.GetString());
            }
            catch
            {
                // 非 JSON 行（SSE 注释、心跳）跳过；不能因为一行解析失败就丢掉整段回答
            }
        }
        return sb.ToString();
    }
}
