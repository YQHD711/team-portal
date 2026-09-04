using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace TeamPortal.Services;

/// <summary>
/// Health check that probes the AI service (Python FastAPI) to verify connectivity.
/// </summary>
public class AiServiceHealthCheck : IHealthCheck
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;

    public AiServiceHealthCheck(IHttpClientFactory httpClientFactory, IConfiguration config)
    {
        _httpClientFactory = httpClientFactory;
        _config = config;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        try
        {
            var baseUrl = _config.GetValue<string>("AiService:BaseUrl")
                ?? _config.GetValue<string>("AiService:Url")
                ?? "http://localhost:9001";
            var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(3);

            var resp = await client.GetAsync($"{baseUrl}/health", ct);
            if (resp.IsSuccessStatusCode)
                return HealthCheckResult.Healthy("AI service reachable");

            return HealthCheckResult.Degraded($"AI service returned {resp.StatusCode}");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Degraded($"AI service unreachable: {ex.Message}");
        }
    }
}
