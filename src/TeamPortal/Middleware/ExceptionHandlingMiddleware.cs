using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using TeamPortal.Services;

namespace TeamPortal.Middleware;

/// <summary>
/// Global exception handler — logs all unhandled exceptions and returns
/// sanitized ProblemDetails JSON with a TraceId for debugging.
/// 响应体整形规则见 <see cref="ErrorPayload"/>（意外异常不回显类型/堆栈/消息）。
/// </summary>
public static class ExceptionHandlingMiddleware
{
    public static void UseTeamPortalExceptionHandler(this WebApplication app)
    {
        app.UseExceptionHandler(errorApp =>
        {
            errorApp.Run(async context =>
            {
                var feature = context.Features.Get<IExceptionHandlerFeature>();
                var exception = feature?.Error;

                var traceId = Activity.Current?.Id ?? context.TraceIdentifier;
                var statusCode = ErrorPayload.StatusFor(exception);

                context.Response.StatusCode = statusCode;
                context.Response.ContentType = "application/problem+json";

                // Log to service（完整异常只进日志，不进响应体）
                if (exception is not null)
                {
                    var log = context.RequestServices.GetRequiredService<LogService>();
                    log.Error("system", exception.Message,
                        $"{exception.GetType().Name}: {exception}\nTraceId: {traceId}\nPath: {context.Request.Path}");
                }

                var (title, detail) = ErrorPayload.For(exception, app.Environment.IsDevelopment(), traceId);
                var problem = new ProblemDetails
                {
                    Status = statusCode,
                    Title = title,
                    Detail = detail,
                    Instance = context.Request.Path,
                    Extensions = { ["traceId"] = traceId }
                };

                await context.Response.WriteAsJsonAsync(problem);
            });
        });
    }
}
