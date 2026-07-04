using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class LogEndpoints
{
    public static void MapLogEndpoints(this WebApplication app)
    {
        var log = app.MapGroup("/api/admin/logs").RequireAuthorization();

        log.MapGet("/", async (string? level, string? category, int page, LogService svc) =>
        {
            var logs = await svc.GetLogs(level, category, page == 0 ? 1 : page, 50);
            return Results.Ok(logs.Select(l => new { l.Id, l.Level, l.Category, l.Message, l.Detail, l.UserName, l.CreatedAt }));
        });
    }
}
