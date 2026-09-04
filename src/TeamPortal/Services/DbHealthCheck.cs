using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// Health check that verifies database connectivity by running a simple query.
/// </summary>
public class DbHealthCheck : IHealthCheck
{
    private readonly IServiceScopeFactory _scopeFactory;

    public DbHealthCheck(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Simple query to verify connectivity
            await db.Users.CountAsync(ct);
            return HealthCheckResult.Healthy("Database reachable");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy($"Database unreachable: {ex.Message}");
        }
    }
}
