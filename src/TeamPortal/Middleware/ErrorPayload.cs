using Microsoft.AspNetCore.Diagnostics;

namespace TeamPortal.Middleware;

/// <summary>
/// 未处理异常 → HTTP 响应体整形（纯函数，便于单测）。
/// 原则：只回显「客户端可自行纠正」的预期异常消息；其它异常一律给通用文案 + traceId，
/// 绝不把异常类型、堆栈、SQL/文件路径回给调用方（开发环境例外，便于本地排查）。
/// </summary>
public static class ErrorPayload
{
    public static int StatusFor(Exception? ex) => ex switch
    {
        BadHttpRequestException => StatusCodes.Status400BadRequest,
        InvalidOperationException => StatusCodes.Status400BadRequest,
        UnauthorizedAccessException => StatusCodes.Status403Forbidden,
        KeyNotFoundException => StatusCodes.Status404NotFound,
        _ => StatusCodes.Status500InternalServerError,
    };

    /// <summary>预期异常：消息本身就是给用户看的（库存不足、非法参数…）</summary>
    public static bool IsExpected(Exception? ex) =>
        ex is BadHttpRequestException or InvalidOperationException or UnauthorizedAccessException or KeyNotFoundException;

    /// <summary>返回 (Title, Detail)。Detail 为空时用 Title 兜底（前端 api.ts 读 detail）</summary>
    public static (string Title, string Detail) For(Exception? ex, bool isDevelopment, string traceId)
    {
        if (ex is null) return ("服务器内部错误", "系统内部错误，请联系管理员。");

        // 预期异常：业务消息可安全回显（前端直接展示 detail）
        if (IsExpected(ex))
            return (ex.Message, isDevelopment ? $"{ex.GetType().Name}: {ex}\nTraceId: {traceId}" : ex.Message);

        // 意外异常：非开发环境不回显任何内部信息
        return isDevelopment
            ? ("服务器内部错误", $"{ex.GetType().Name}: {ex}\nTraceId: {traceId}")
            : ("服务器内部错误", $"系统内部错误，请联系管理员。（traceId: {traceId}）");
    }
}
