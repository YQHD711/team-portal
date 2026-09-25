using System.Text;

namespace TeamPortal.Services;

/// <summary>
/// AI 运维助手的 DeepSeek 调用层：一次 chat/completions 请求 + 网络错误的用户可读化。
/// 与主循环分开，避免主循环文件过长。
/// </summary>
public partial class SystemAgentService
{
    private sealed record ApiReply(bool Ok, string Body, int Ms, string? Error);

    /// <summary>单次 DeepSeek chat/completions 调用；网络层失败直接返回给用户可读的 Error。</summary>
    private async Task<ApiReply> PostChatAsync(string json, string apiKey, string baseUrl, int reqTimeoutSec, CancellationToken outer, string userName)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
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
}
