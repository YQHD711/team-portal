using TeamPortal.Middleware;

namespace api;

/// <summary>
/// 请求日志的**判定逻辑**单测（不依赖 DB，故不受当前迁移问题影响）：
///  - 级别按状态码/耗时分级：5xx→error、4xx→warn、慢请求→warn、其余 info
///  - Detail 是结构化 JSON：含 durationMs/bytes/ip/ua/requestId/slow（响应速度可查询）
///  - 5xx 异常摘要**脱敏**：不含 token/连接串片段
///  - 用户名从 ctx.User 取（修复前因中间件在认证之前，永远是空 → 见 Program.cs 的注册顺序）
/// </summary>
public class RequestLoggingTests
{
    [Theory]
    [InlineData(200, 10, "info")]
    [InlineData(301, 5, "info")]
    [InlineData(404, 5, "warn")]
    [InlineData(401, 5, "warn")]
    [InlineData(500, 5, "error")]
    [InlineData(503, 5, "error")]
    [InlineData(200, 1500, "warn")]   // 慢请求：2xx 但超过 1000ms → warn
    public void LevelOf_MapsStatusAndSlowRequests(int status, long durationMs, string expected)
        => Assert.Equal(expected, RequestLoggingMiddleware.LevelOf(status, durationMs));

    [Fact]
    public void BuildDetail_ContainsStructuredPerformanceFields()
    {
        var json = RequestLoggingMiddleware.BuildDetail(
            "GET", "/api/inventory", 200, 42, 1024, "203.0.113.9", "Mozilla/5.0", "rid-123", null);

        Assert.Contains("\"method\":\"GET\"", json);
        Assert.Contains("\"path\":\"/api/inventory\"", json);
        Assert.Contains("\"status\":200", json);
        Assert.Contains("\"durationMs\":42", json);       // 响应速度是独立字段，可从 Detail 读出做统计
        Assert.Contains("\"bytes\":1024", json);
        Assert.Contains("\"ip\":\"203.0.113.9\"", json);
        Assert.Contains("\"requestId\":\"rid-123\"", json);
        Assert.Contains("\"slow\":false", json);
    }

    [Fact]
    public void BuildDetail_MarksSlowRequests()
    {
        var json = RequestLoggingMiddleware.BuildDetail(
            "GET", "/api/slow", 200, 2500, 0, "-", null, "rid", null);

        Assert.Contains("\"slow\":true", json);
    }

    [Fact]
    public void ExceptionSummary_RedactsSecrets()
    {
        var ex = new InvalidOperationException("connect failed: Bearer abc.def.ghi; Password=hunter2");

        var summary = RequestLoggingMiddleware.ExceptionSummary(ex);

        Assert.NotNull(summary);
        Assert.StartsWith("InvalidOperationException:", summary);
        Assert.DoesNotContain("abc.def.ghi", summary);
        Assert.DoesNotContain("hunter2", summary);
        Assert.Contains("<redacted>", summary);
    }

    [Fact]
    public void ExceptionSummary_TruncatesLongMessages()
    {
        var summary = RequestLoggingMiddleware.ExceptionSummary(new Exception(new string('x', 2000)));

        Assert.NotNull(summary);
        Assert.True(summary!.Length <= 400);
    }

    [Fact]
    public void ExceptionSummary_NullWhenNoException()
        => Assert.Null(RequestLoggingMiddleware.ExceptionSummary(null));

    // ── 降噪：/health 完全跳过 ──
    [Theory]
    [InlineData("/health", true)]
    [InlineData("/HEALTH", true)]
    [InlineData("/health/", false)]
    [InlineData("/healthz", false)]
    [InlineData("/api/health", false)]
    public void ShouldSkip_OnlyExactHealthPath(string path, bool expected)
        => Assert.Equal(expected, RequestLoggingMiddleware.ShouldSkip(path));

    // ── 同请求去重：窗口内同 key 只落一条（键含 status，401 与 200 不会互相吞） ──
    [Fact]
    public void ShouldLogOnce_DedupesSameKeyInsideWindow()
    {
        var key = "req|GET|/api/public/brand|200|匿名|-|" + Guid.NewGuid().ToString("N");
        var t0 = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        Assert.True(RequestLoggingMiddleware.ShouldLogOnce(key, 60, t0));
        Assert.False(RequestLoggingMiddleware.ShouldLogOnce(key, 60, t0.AddSeconds(59)));
        Assert.True(RequestLoggingMiddleware.ShouldLogOnce(key, 60, t0.AddSeconds(61)));
    }

    [Fact]
    public void ShouldLogOnce_KeepsDifferentStatuses()
    {
        var key200 = "req|GET|/api/x|200|匿名|-|" + Guid.NewGuid().ToString("N");
        var key401 = key200.Replace("|200|", "|401|");
        var t0 = DateTime.UtcNow;

        Assert.True(RequestLoggingMiddleware.ShouldLogOnce(key200, 60, t0));
        Assert.True(RequestLoggingMiddleware.ShouldLogOnce(key401, 60, t0));
    }

    [Fact]
    public void ShouldLogOnce_ZeroWindowDisablesDedupe()
    {
        var key = "req|GET|/api/y|200|匿名|-|" + Guid.NewGuid().ToString("N");
        var t0 = DateTime.UtcNow;

        Assert.True(RequestLoggingMiddleware.ShouldLogOnce(key, 0, t0));
        Assert.True(RequestLoggingMiddleware.ShouldLogOnce(key, 0, t0));
    }

    // ── HTTPS 可观测性：scheme / host / 原始 X-Forwarded-For ──
    [Fact]
    public void BuildDetail_ContainsSchemeHostAndRawXff()
    {
        var json = RequestLoggingMiddleware.BuildDetail(
            "GET", "/api/auth/me", 200, 5, 0, "203.0.113.9", null, "rid", null,
            scheme: "https", host: "8.137.161.160", xff: "203.0.113.9, 10.255.1.3");

        Assert.Contains("\"scheme\":\"https\"", json);
        Assert.Contains("\"host\":\"8.137.161.160\"", json);
        Assert.Contains("\"xff\":\"203.0.113.9, 10.255.1.3\"", json);
    }

    [Fact]
    public void BuildDetail_TruncatesLongXff()
    {
        var xff = string.Join(", ", Enumerable.Range(0, 100).Select(i => "10.0.0." + i));
        var json = RequestLoggingMiddleware.BuildDetail(
            "GET", "/api/x", 403, 5, 0, "-", null, "rid", null, xff: xff);

        Assert.DoesNotContain(xff, json); // 客户端可伪造任意长头，Detail 必须截断
        Assert.Contains("\"xff\":\"", json);
    }
}

