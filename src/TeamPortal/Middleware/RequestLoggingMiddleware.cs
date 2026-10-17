using System.Diagnostics;
using System.Text.Json;

namespace TeamPortal.Middleware;

/// <summary>
/// 每个 HTTP 请求记一条系统日志（**不过滤任何路径**：/health、轮询接口都记）。
///
/// 关键点（实测问题）：
///  1. **必须注册在认证之后**：原来在 `UseAuthentication()` 之前，写日志时 `ctx.User` 还没填充，
///     于是「用户」列永远是空 —— 日志记了时间/路径/状态码却不知道"是谁"。
///  2. **按状态码分级**：5xx→error、4xx→warn、其余 info；耗时 &gt; <see cref="SlowRequestMs"/> → warn + [SLOW]。
///  3. **结构化数据放 Detail（JSON）**：method/path/status/durationMs/bytes/ip/ua/requestId/slow。
///  4. **不记 body / token / 密码**；5xx 只记异常类型 + 脱敏后的消息。
///  5. 写日志走 LogService 的后台 channel（非阻塞）。
/// </summary>
public static class RequestLoggingMiddleware
{
    /// <summary>慢请求阈值（毫秒）：超过即 warn 级别并打 [SLOW] 标记</summary>
    public const int SlowRequestMs = 1000;

    /// <summary>RequestId 头：前端可自带，便于把一次请求的多条日志串起来</summary>
    public const string RequestIdHeader = "X-Request-Id";

    /// <summary>按状态码 + 耗时决定日志级别（5xx→error、4xx→warn、慢请求→warn、其余 info）</summary>
    public static string LevelOf(int statusCode, long durationMs)
    {
        if (statusCode >= 500) return "error";
        if (statusCode >= 400) return "warn";
        return durationMs > SlowRequestMs ? "warn" : "info";
    }

    /// <summary>结构化信息 → JSON（写入 Detail 列，便于读出响应速度等指标）</summary>
    public static string BuildDetail(
        string method, string path, int statusCode, long durationMs, long bytesSent,
        string ip, string? userAgent, string requestId, string? exception)
    {
        var payload = new Dictionary<string, object?>
        {
            ["method"] = method,
            ["path"] = path,
            ["status"] = statusCode,
            ["durationMs"] = durationMs,
            ["bytes"] = bytesSent,
            ["ip"] = ip,
            ["ua"] = Truncate(userAgent, 200),
            ["requestId"] = requestId,
            ["slow"] = durationMs > SlowRequestMs,
        };
        if (exception is not null) payload["exception"] = exception;
        return JsonSerializer.Serialize(payload);
    }

    /// <summary>5xx 的异常摘要：类型 + 脱敏消息（去掉 token/连接串等敏感片段）</summary>
    public static string? ExceptionSummary(Exception? ex)
    {
        if (ex is null) return null;
        var msg = ex.Message ?? "";
        foreach (var keyword in new[] { "Bearer ", "Password=", "token=", "Token=" })
        {
            var idx = msg.IndexOf(keyword, StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) msg = msg[..idx] + "<redacted>";
        }
        return Truncate($"{ex.GetType().Name}: {msg}", 400);
    }

    private static string? Truncate(string? value, int max)
        => value is null ? null : value.Length <= max ? value : value[..max];

    public static void UseRequestLogging(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            var sw = Stopwatch.StartNew();
            var method = context.Request.Method;
            var path = context.Request.Path.ToString();
            var requestId = context.Request.Headers[RequestIdHeader].ToString();
            if (string.IsNullOrWhiteSpace(requestId)) requestId = Guid.NewGuid().ToString("N")[..16];
            context.Response.Headers[RequestIdHeader] = requestId;

            Exception? failure = null;
            try
            {
                await next();
            }
            catch (Exception ex)
            {
                failure = ex;
                throw;
            }
            finally
            {
                sw.Stop();
                var status = context.Response.StatusCode;
                var durationMs = sw.ElapsedMilliseconds;
                var level = LevelOf(status, durationMs);
                // 用户名：注册在认证之后 → 这里 ctx.User 已填充；未登录则记 null（库里/前端显示"匿名"）
                var user = context.User?.Identity?.IsAuthenticated == true ? context.User.Identity.Name : null;
                var ip = context.Connection.RemoteIpAddress?.ToString() ?? "-";
                var userAgent = context.Request.Headers.UserAgent.ToString();
                long bytes = 0;
                try { bytes = context.Response.ContentLength ?? 0; } catch { /* 未设置记 0 */ }
                var exception = status >= 500 ? ExceptionSummary(failure) : null;
                var detail = BuildDetail(method, path, status, durationMs, bytes, ip, userAgent, requestId, exception);

                var log = context.RequestServices.GetService<Services.LogService>();
                var who = user ?? "匿名";
                var slowTag = durationMs > SlowRequestMs ? " [SLOW]" : "";
                log?.Log(level, "http", $"{method} {path} → {status} ({durationMs}ms){slowTag} [{who}]", detail, user);
            }
        });
    }
}
