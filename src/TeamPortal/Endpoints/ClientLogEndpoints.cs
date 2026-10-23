using System.Text.Json;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 浏览器端错误上报：POST /api/client-logs。
///  - **匿名可用**（未登录页/登录页崩溃也要能上报），用 default 限流策略按来源 IP 分桶防止刷日志；
///  - 请求体 {level?, message, stack?, url?}，level 只接受 info|warn|error（缺省/非法按 warn，不返回 400）；
///  - 字段截断：message 500 / stack 2000 / url 500，避免一条前端异常把日志表撑爆；
///  - 写 SystemLog category="client"，尽量带上当前用户与来源 IP；日志失败不影响响应，**始终 204**。
/// </summary>
public static class ClientLogEndpoints
{
    private static readonly string[] AllowedLevels = { "info", "warn", "error" };

    /// <summary>请求体。前端多带的 type/source/line/column 等未知字段由 System.Text.Json 默认忽略。</summary>
    public sealed record ClientLogRequest(string? Level, string? Message, string? Stack, string? Url);

    public static void MapClientLogEndpoints(this WebApplication app)
    {
        app.MapPost("/api/client-logs", (ClientLogRequest? body, HttpContext ctx, LogService log, ILoggerFactory loggerFactory) =>
        {
            try
            {
                var message = Truncate(body?.Message, 500)?.Trim();
                if (string.IsNullOrWhiteSpace(message)) return Results.NoContent(); // 空消息忽略，但仍 204

                var level = NormalizeLevel(body?.Level);
                var user = ctx.User?.Identity?.IsAuthenticated == true ? ctx.User.Identity.Name : null;
                var ip = LogService.ClientIp(ctx);
                var detail = JsonSerializer.Serialize(new
                {
                    ip,
                    url = Truncate(body?.Url, 500),
                    stack = Truncate(body?.Stack, 2000),
                    userAgent = Truncate(ctx.Request.Headers.UserAgent.ToString(), 200),
                });
                log.Log(level, "client", message, detail, user);
            }
            catch (Exception ex)
            {
                // 日志失败绝不拖累客户端：上报接口始终 204，异常只进服务端控制台。
                loggerFactory.CreateLogger("client-log").LogWarning(ex, "client log report dropped");
            }
            return Results.NoContent();
        }).RequireRateLimiting("default");
    }

    /// <summary>只允许 info|warn|error；缺省/非法值一律按 warn（前端传错不产生 400）。</summary>
    public static string NormalizeLevel(string? level)
    {
        var normalized = level?.Trim().ToLowerInvariant();
        return normalized is not null && AllowedLevels.Contains(normalized) ? normalized : "warn";
    }

    /// <summary>截断到上限（null 保持 null）。</summary>
    public static string? Truncate(string? value, int max)
        => value is null ? null : value.Length <= max ? value : value[..max];
}
