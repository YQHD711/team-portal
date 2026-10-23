using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// AI 运维助手的 **OpenAI 兼容**调用层：chat/completions（非流式 + 流式转发）+ 网络错误的用户可读化。
/// 不绑定服务商；模型/端点/密钥由 <see cref="AiClient.ResolveAsync"/> 解析。与主循环分开，避免文件过长。
/// </summary>
public partial class SystemAgentService
{
    private sealed record ApiReply(bool Ok, string Body, int Ms, string? Error);

    /// <summary>流式运行的结果：Answer 为累计正文（供记忆落库），Error 非空表示失败（已通过 SSE error 事件告知前端）。</summary>
    public sealed record AgentStreamResult(string Answer, int Iterations, int ToolCalls, string? Error);

    /// <summary>拼装初始消息：system prompt + 历史 + 本轮 task。</summary>
    private static List<object> BuildMessages(string task, List<(string role, string content)>? history)
    {
        var messages = new List<object> { new { role = "system", content = BuildSystemPrompt() } };
        if (history != null && history.Count > 0)
        {
            foreach (var (role, content) in history)
                messages.Add(new { role, content });
        }
        messages.Add(new { role = "user", content = task });
        return messages;
    }

    /// <summary>单次 chat/completions 调用；网络层失败直接返回给用户可读的 Error。</summary>
    private async Task<ApiReply> PostChatAsync(string json, string apiKey, string baseUrl, int reqTimeoutSec, CancellationToken outer, string userName)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, AiOptions.EndpointFor(baseUrl, "/chat/completions"))
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("Authorization", $"Bearer {apiKey}");

        var start = DateTime.UtcNow;
        using var reqCts = CancellationTokenSource.CreateLinkedTokenSource(outer);
        reqCts.CancelAfter(TimeSpan.FromSeconds(reqTimeoutSec));
        HttpResponseMessage resp;
        string body;
        try
        {
            resp = await _http.SendAsync(req, reqCts.Token);
            body = await resp.Content.ReadAsStringAsync(reqCts.Token);
        }
        catch (OperationCanceledException) when (!outer.IsCancellationRequested)
        {
            _log.Warn("agent", $"Request timeout: {reqTimeoutSec}s", null, userName);
            return new ApiReply(false, "", 0, $"❌ 单次 API 请求超时 ({reqTimeoutSec}秒)，请增大 AI:RequestTimeoutSeconds 设置或简化问题");
        }
        var ms = (int)(DateTime.UtcNow - start).TotalMilliseconds;

        if (!resp.IsSuccessStatusCode)
        {
            _log.Error("agent", "API error", $"HTTP {resp.StatusCode}: {body[..Math.Min(200, body.Length)]} (took {ms}ms)", userName);
            if ((int)resp.StatusCode == 429) return new ApiReply(false, "", ms, "❌ API 频率限制，请稍后再试");
            return new ApiReply(false, "", ms, $"❌ API 错误 ({resp.StatusCode}): {body[..Math.Min(body.Length, 200)]}");
        }
        return new ApiReply(true, body, ms, null);
    }

    private static string SseFrame(string eventName, object data)
        => $"event: {eventName}\ndata: {JsonSerializer.Serialize(data)}\n\n";

    /// <summary>
    /// task-13 流式运行：工具轮复用 <see cref="RunToolLoopAsync"/>（非流式，带 tools），
    /// 最终作答阶段改 stream:true，把 provider 的 SSE 行**原样**通过 <paramref name="sendSse"/> 转发，
    /// 同时累计正文供会话记忆落库；过程中用 event:status 推送轮次/工具名/等待状态。
    /// 客户端断开（<paramref name="ct"/> 取消）时静默结束并取消上游请求。
    /// </summary>
    public async Task<AgentStreamResult> RunAgentStream(
        string task, string userName, List<(string role, string content)>? history,
        Func<string, Task> sendSse, CancellationToken ct)
    {
        var opt = await _ai.ResolveAsync();
        if (string.IsNullOrEmpty(opt.ApiKey)) return new("", 0, 0, "❌ AI 密钥未配置");

        var messages = BuildMessages(task, history);
        var agentTimeoutMin = await _settings.GetInt("AI:AgentTimeoutMinutes", 20);
        var reqTimeoutSec = opt.RequestTimeoutSeconds;
        var maxIterations = await _settings.GetInt("AI:MaxIterations", 25);
        _log.Info("agent", $"Agent stream start: task={task[..Math.Min(80, task.Length)]}, history={history?.Count ?? 0}, model={opt.Model}, timeout={agentTimeoutMin}min", null, userName);

        var answer = new StringBuilder();
        var iterations = 0;
        var toolCalls = 0;
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromMinutes(agentTimeoutMin)); // 总时长兜底
        var token = timeoutCts.Token;

        try
        {
            await sendSse(SseFrame("status", new { phase = "start", message = "正在连接模型…" }));

            var outcome = await RunToolLoopAsync(opt, messages, BuildTools(), userName, maxIterations, reqTimeoutSec, token,
                round => sendSse(SseFrame("status", new { phase = "round", round, message = $"第 {round} 轮：等待模型分析…" })),
                (round, names) => sendSse(SseFrame("status", new
                {
                    phase = "tool", round, tools = names,
                    message = $"已调用：{string.Join("、", names)}",
                })));
            iterations = outcome.Iterations;
            toolCalls = outcome.ToolCalls;

            if (outcome.Error is not null) return new(answer.ToString(), iterations, toolCalls, outcome.Error);
            if (outcome.TimedOut)
                return new(answer.ToString(), iterations, toolCalls,
                    $"分析超时（{agentTimeoutMin}分钟），请增大 AI:AgentTimeoutMinutes 设置或简化问题");
            if (outcome.HitCap)
                messages.Add(new { role = "system", content = $"已达到最大迭代次数（{maxIterations}轮），请基于已有结果尽量完整作答；缺失部分明确说明。" });

            await sendSse(SseFrame("status", new { phase = "answering", message = "正在生成回答…" }));
            var payload = _ai.BuildChatPayload(opt, messages, stream: true);
            HttpResponseMessage resp;
            try
            {
                resp = await _http.SendAsync(_ai.CreateChatRequest(opt, payload), HttpCompletionOption.ResponseHeadersRead, token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return new(answer.ToString(), iterations, toolCalls,
                    $"❌ 请求超时（{reqTimeoutSec}秒），请增大 AI:RequestTimeoutSeconds 设置或简化问题");
            }

            using (resp)
            {
                if (!resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync(token);
                    _log.Error("agent", "Stream API error", $"HTTP {resp.StatusCode}: {body[..Math.Min(200, body.Length)]}", userName);
                    var msg = (int)resp.StatusCode == 429
                        ? "❌ API 频率限制，请稍后再试"
                        : $"❌ API 错误 ({resp.StatusCode}): {body[..Math.Min(body.Length, 200)]}";
                    return new(answer.ToString(), iterations, toolCalls, msg);
                }

                await using var stream = await resp.Content.ReadAsStreamAsync(token);
                using var reader = new StreamReader(stream);
                while (true)
                {
                    var line = await reader.ReadLineAsync(token);
                    if (line is null) break;
                    if (line.StartsWith("data:", StringComparison.Ordinal))
                    {
                        var data = line[5..].TrimStart();
                        if (data.Length > 0 && data != "[DONE]")
                        {
                            try
                            {
                                using var doc = JsonDocument.Parse(data);
                                answer.Append(AiClient.ExtractDeltaContent(doc.RootElement) ?? "");
                            }
                            catch { /* 非 JSON 的 data 行：原样转发，不累计正文 */ }
                        }
                    }
                    await sendSse(line + "\n"); // 原样转发（含 data/[DONE]/空行分帧）
                }
            }

            _log.Info("agent", $"Agent stream done: {iterations} iters, {toolCalls} tools, answer={answer.Length} chars", null, userName);
            return new(answer.ToString(), iterations, toolCalls, null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _log.Info("agent", "Agent stream cancelled by client", null, userName);
            return new(answer.ToString(), iterations, toolCalls, null); // 客户端断开：静默结束
        }
        catch (OperationCanceledException)
        {
            _log.Warn("agent", $"Agent stream timeout: {iterations} iters, {toolCalls} tools", null, userName);
            return new(answer.ToString(), iterations, toolCalls,
                $"分析超时（{agentTimeoutMin}分钟），请增大 AI:AgentTimeoutMinutes 设置或简化问题");
        }
        catch (Exception ex)
        {
            _log.Error("agent", "Agent stream failed", ex.Message, userName);
            return new(answer.ToString(), iterations, toolCalls, $"❌ 分析失败: {ex.Message}");
        }
    }
}
