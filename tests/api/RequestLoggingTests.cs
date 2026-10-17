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
}
