using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using TeamPortal.Services;

namespace TeamPortal.Middleware;

/// <summary>
/// Global exception handler — logs all unhandled exceptions and returns
/// sanitized ProblemDetails JSON with a TraceId for debugging.
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
                var statusCode = exception switch
                {
                    InvalidOperationException => StatusCodes.Status400BadRequest,
                    UnauthorizedAccessException => StatusCodes.Status403Forbidden,
                    KeyNotFoundException => StatusCodes.Status404NotFound,
                    _ => StatusCodes.Status500InternalServerError,
                };

                context.Response.StatusCode = statusCode;
                context.Response.ContentType = "application/problem+json";

                // Log to service
                if (exception is not null)
                {
                    var log = context.RequestServices.GetRequiredService<LogService>();
                    log.Error("system", exception.Message,
                        $"{exception.GetType().Name}: {exception}\nTraceId: {traceId}\nPath: {context.Request.Path}");
                }

                var problem = new ProblemDetails
                {
                    Status = statusCode,
                    Title = exception?.Message ?? "服务器内部错误",
                    Detail = app.Environment.IsDevelopment()
                        ? $"{exception?.GetType().Name}: {exception}\nTraceId: {traceId}"
                        : "系统内部错误，请联系管理员。",
                    Instance = context.Request.Path,
                    Extensions = { ["traceId"] = traceId }
                };

                await context.Response.WriteAsJsonAsync(problem);
            });
        });
    }
}
