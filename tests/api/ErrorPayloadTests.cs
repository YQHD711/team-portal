using Microsoft.AspNetCore.Http;
using TeamPortal.Middleware;

namespace api;

/// <summary>
/// 未处理异常 → 响应体整形：意外异常在非开发环境绝不回显类型/堆栈/消息；
/// 预期异常（库存不足等）必须保留业务消息，否则前端拿到通用文案无法提示用户。
/// </summary>
public class ErrorPayloadTests
{
    private static readonly Exception Unexpected = new("SQLite Error 8: 'attempt to write a readonly database' at /data/teamportal.db");

    [Fact]
    public void UnexpectedException_InProduction_HidesInternals()
    {
        var (title, detail) = ErrorPayload.For(Unexpected, isDevelopment: false, traceId: "trace-1");

        Assert.DoesNotContain("readonly database", title);
        Assert.DoesNotContain("readonly database", detail);
        Assert.DoesNotContain("/data/teamportal.db", detail);
        Assert.DoesNotContain("Exception", detail);
        Assert.Contains("trace-1", detail);          // 仍给出可追踪的 traceId
    }

    [Fact]
    public void UnexpectedException_InDevelopment_ExposesStackForDebugging()
    {
        var (_, detail) = ErrorPayload.For(Unexpected, isDevelopment: true, traceId: "trace-2");

        Assert.Contains(nameof(Exception), detail);
        Assert.Contains("readonly database", detail);
        Assert.Contains("trace-2", detail);
    }

    [Theory]
    [InlineData("库存不足")]
    [InlineData("密码长度至少 6 位")]
    public void ExpectedException_KeepsBusinessMessage_InBothEnvironments(string message)
    {
        var ex = new InvalidOperationException(message);

        Assert.True(ErrorPayload.IsExpected(ex));
        foreach (var dev in new[] { true, false })
        {
            var (title, detail) = ErrorPayload.For(ex, dev, "trace-3");
            Assert.Equal(message, title);
            Assert.Contains(message, detail);
        }
    }

    [Fact]
    public void StatusMap_MatchesExceptionKind()
    {
        Assert.Equal(StatusCodes.Status400BadRequest, ErrorPayload.StatusFor(new InvalidOperationException()));
        Assert.Equal(StatusCodes.Status400BadRequest, ErrorPayload.StatusFor(new BadHttpRequestException("bad body")));
        Assert.Equal(StatusCodes.Status403Forbidden, ErrorPayload.StatusFor(new UnauthorizedAccessException()));
        Assert.Equal(StatusCodes.Status404NotFound, ErrorPayload.StatusFor(new KeyNotFoundException()));
        Assert.Equal(StatusCodes.Status500InternalServerError, ErrorPayload.StatusFor(Unexpected));
        Assert.Equal(StatusCodes.Status500InternalServerError, ErrorPayload.StatusFor(null));
    }

    [Fact]
    public void NullException_FallsBackToGenericMessage()
    {
        var (title, detail) = ErrorPayload.For(null, isDevelopment: true, traceId: "trace-4");

        Assert.Equal("服务器内部错误", title);
        Assert.DoesNotContain("trace-4", title);
        Assert.NotEmpty(detail);
    }
}
