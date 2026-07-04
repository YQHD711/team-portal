using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class FlightLogEndpoints
{
    public static void MapFlightLogEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/flightlogs").RequireAuthorization();

        group.MapGet("/", async (FlightLogService svc) =>
        {
            var result = await svc.ListLogs();
            return result is not null ? Results.Ok(result) : Results.Problem("Service unavailable", statusCode: 503);
        });

        group.MapGet("/{filename}", async (string filename, FlightLogService svc) =>
        {
            var result = await svc.ParseLog(filename);
            return result is not null ? Results.Ok(result) : Results.Problem("Parse failed", statusCode: 503);
        });
    }
}
