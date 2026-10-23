using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;

namespace TeamPortal.Middleware;

/// <summary>
/// 每个 HTTP 请求记一条系统日志。三条降噪/补强规则：
///  1. **完全跳过 /health**：docker healthcheck 每 30 秒打一次，实测占近期请求日志约 65%，
///     把真正有用的证据挤掉；健康检查失败由 healthcheck 自身与容器重启暴露，不需要日志。
///  2. **同请求窗口去重**：同一 (method, path, status, user, ip) 在窗口内只落一条，
///     避免 /api/public/brand 这类轮询把 SystemLogs 刷爆。窗口取 RequestLogging:DedupeWindowSeconds
///     （默认 60 秒，0 = 关闭）。ConcurrentDictionary 存"签名→上次落库时刻"，并按窗口定期清理防内存增长。
///  3. **401/403 授权拒绝单独进操作审计**（OperationLog action=denied）：拒绝是安全事件，
///     与请求日志分开保存、可长期查询；同样按 userId+path+status 在窗口内去重。
///
/// **注册顺序：必须在使用认证/授权中间件之前**（见 Program.cs 注释）。被 401/403 拒绝的请求
/// 由鉴权/授权短路返回，注册在它们之后会整批漏记；注册在前时 await next() 内部仍会跑完认证，
/// finally 里再读 ctx.User 拿到的就是认证后的用户，用户名不会丢。
/// 其余约束：按状态码分级；Detail 是结构化 JSON；不记 body/token/密码；写日志走 LogService 后台 channel。
/// </summary>
public static class RequestLoggingMiddleware
{
    /// <summary>慢请求阈值（毫秒）：超过即 warn 级别并打 [SLOW] 标记</summary>
    public const int SlowRequestMs = 1000;

    /// <summary>RequestId 头：前端可自带，便于把一次请求的多条日志串起来</summary>
    public const string RequestIdHeader = "X-Request-Id";

    /// <summary>健康检查路径：docker healthcheck 每 30s 打一次（占近期请求日志约 65%），完全跳过。</summary>
    public const string HealthPath = "/health";

    /// <summary>去重签名 → 上次落库 UTC ticks；按窗口定期清扫，避免匿名路径/带参路径无限增长。</summary>
    private static readonly ConcurrentDictionary<string, long> Recent = new();
    private static long _lastSweepTicks;

    /// <summary>按状态码 + 耗时决定日志级别（5xx→error、4xx→warn、慢请求→warn、其余 info）</summary>
    public static string LevelOf(int statusCode, long durationMs)
    {
        if (statusCode >= 500) return "error";
        if (statusCode >= 400) return "warn";
        return durationMs > SlowRequestMs ? "warn" : "info";
    }

    /// <summary>健康检查路径不落请求日志（大小写不敏感，仅精确匹配 /health）。</summary>
    public static bool ShouldSkip(string path)
        => path.Equals(HealthPath, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 同请求去重：窗口内同一 key 只返回一次 true；windowSeconds &lt;= 0 关闭去重。
    /// 时间由调用方传入，行为可单测；内部字典每窗口最多清扫一次。
    /// </summary>
    public static bool ShouldLogOnce(string key, int windowSeconds, DateTime utcNow)
    {
        if (windowSeconds <= 0) return true;
        var now = utcNow.Ticks;
        var windowTicks = TimeSpan.FromSeconds(windowSeconds).Ticks;
        if (Recent.TryGetValue(key, out var last) && now - last < windowTicks) return false;
        Recent[key] = now;
        Sweep(now, windowTicks);
        return true;
    }

    /// <summary>清掉 2 个窗口前的旧签名；每窗口最多扫一次，避免高频请求时每次都全表遍历。</summary>
    private static void Sweep(long nowTicks, long windowTicks)
    {
        var last = Interlocked.Read(ref _lastSweepTicks);
        if (nowTicks - last < windowTicks) return;
        if (Interlocked.CompareExchange(ref _lastSweepTicks, nowTicks, last) != last) return;
        var cutoff = nowTicks - windowTicks * 2;
        foreach (var kv in Recent)
            if (kv.Value < cutoff) Recent.TryRemove(kv.Key, out _);
    }

    /// <summary>结构化信息 → JSON（写入 Detail 列，便于读出响应速度、TLS 与代理链路信息）</summary>
    public static string BuildDetail(
        string method, string path, int statusCode, long durationMs, long bytesSent,
        string ip, string? userAgent, string requestId, string? exception,
        string scheme = "http", string host = "-", string? xff = null)
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
            ["scheme"] = scheme,           // HTTPS 后可核对请求确实走了 TLS；代理未透传 X-Forwarded-Proto 时为 http
            ["host"] = Truncate(host, 200),
            ["xff"] = Truncate(xff, 500),  // 原始 X-Forwarded-For（客户端可控，只作排查留证，不参与鉴权）
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
        // 0 = 关闭去重；未配置默认 60 秒（可用 RequestLogging__DedupeWindowSeconds 环境变量覆盖）
        var dedupeWindow = int.TryParse(app.Configuration["RequestLogging:DedupeWindowSeconds"], out var w)
            ? Math.Max(0, w) : 60;

        app.Use(async (context, next) =>
        {
            var method = context.Request.Method;
            var path = context.Request.Path.ToString();
            if (ShouldSkip(path)) { await next(); return; } // 健康检查：不记日志，也不发 request-id

            var sw = Stopwatch.StartNew();
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
                // 用户名：中间件在认证之前注册，但这是 finally（await next() 已跑完认证）→ ctx.User 已填充；未登录记 null
                var user = context.User?.Identity?.IsAuthenticated == true ? context.User.Identity.Name : null;
                var ip = Services.LogService.ClientIp(context) ?? "-";
                var userId = int.TryParse(context.User?.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : (int?)null;
                var scheme = context.Request.Scheme;
                var host = context.Request.Host.Value ?? "-";
                // 原始 XFF 在 Program.cs 里于 UseForwardedHeaders 之前已存入 Items（中间件会清空该头）
                var xff = context.Items.TryGetValue("raw_xff", out var rawXff) && rawXff is string rawS
                    ? rawS
                    : context.Request.Headers["X-Forwarded-For"].ToString();
                var userAgent = context.Request.Headers.UserAgent.ToString();
                long bytes = 0;
                try { bytes = context.Response.ContentLength ?? 0; } catch { /* 未设置记 0 */ }
                var exception = status >= 500 ? ExceptionSummary(failure) : null;
                var log = context.RequestServices.GetService<Services.LogService>();

                // a) 同请求去重：轮询接口（/api/public/brand 等）不再每分钟刷爆 SystemLogs
                if (ShouldLogOnce($"req|{method}|{path}|{status}|{user}|{ip}", dedupeWindow, DateTime.UtcNow))
                {
                    var detail = BuildDetail(method, path, status, durationMs, bytes, ip, userAgent,
                        requestId, exception, scheme, host, xff);
                    var who = user ?? "匿名";
                    var slowTag = durationMs > SlowRequestMs ? " [SLOW]" : "";
                    log?.Log(level, "http", $"{method} {path} → {status} ({durationMs}ms){slowTag} [{who}]", detail, user);
                }

                // b) 授权拒绝审计：401/403 且路径在 /api 下、已认证用户存在才记（匿名 401 不算安全事件）
                if ((status == 401 || status == 403)
                    && path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)
                    && user is not null && userId is not null
                    && ShouldLogOnce($"denied|{userId}|{path}|{status}", dedupeWindow, DateTime.UtcNow))
                {
                    log?.Audit("denied", user, targetType: "http", targetId: path,
                        data: new { method, status, scheme }, ipAddress: ip, userId: userId);
                }
            }
        });
    }
}