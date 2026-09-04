using System.Diagnostics;

namespace TeamPortal.Middleware;

/// <summary>
/// Request logging middleware — logs method, path, status code, duration, and client IP
/// for every HTTP request. Registered as the first middleware in the pipeline.
/// </summary>
public static class RequestLoggingMiddleware
{
    public static void UseRequestLogging(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            var sw = Stopwatch.StartNew();
            var path = context.Request.Path;
            var method = context.Request.Method;

            try
            {
                await next();
            }
            finally
            {
                sw.Stop();
                var status = context.Response.StatusCode;
                var ip = context.Connection.RemoteIpAddress?.ToString() ?? "-";

                var log = context.RequestServices.GetRequiredService<Services.LogService>();
                var level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
                log.Log(level, "http",
                    $"{method} {path} → {status} ({sw.ElapsedMilliseconds}ms)",
                    $"IP: {ip}");
            }
        });
    }
}
