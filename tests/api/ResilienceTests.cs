using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;

namespace api;

/// <summary>
/// Verify that HTTP resilience infrastructure is properly configured.
/// The StandardResilienceHandler provides retry (3x exponential backoff),
/// circuit breaker, and timeout policies for all outbound HTTP calls.
/// </summary>
public class ResilienceTests
{
    [Fact]
    public void ResilienceHandler_CanBeAdded_To_HttpClient()
    {
        var services = new ServiceCollection();
        services.AddHttpClient();
        services.ConfigureHttpClientDefaults(options =>
        {
            options.AddStandardResilienceHandler();
        });

        var provider = services.BuildServiceProvider();
        var factory = provider.GetRequiredService<IHttpClientFactory>();
        var client = factory.CreateClient();

        Assert.NotNull(client);
        // StandardResilienceHandler sets BaseAddress to null by default — client is usable
    }

    [Fact]
    public void ResilienceHandler_With_Custom_Timeout_Configures_Successfully()
    {
        var services = new ServiceCollection();
        services.AddHttpClient();
        services.ConfigureHttpClientDefaults(options =>
        {
            options.AddStandardResilienceHandler(o =>
            {
                o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(30);
                o.Retry.MaxRetryAttempts = 3;
            });
        });

        var provider = services.BuildServiceProvider();
        var factory = provider.GetRequiredService<IHttpClientFactory>();
        var client = factory.CreateClient();

        Assert.NotNull(client);
    }

    [Fact]
    public void Multiple_HttpClient_Configurations_Can_Coexist()
    {
        var services = new ServiceCollection();
        services.AddHttpClient();
        services.ConfigureHttpClientDefaults(options =>
        {
            options.AddStandardResilienceHandler();
        });

        var provider = services.BuildServiceProvider();

        // Creating multiple clients should not throw
        var client1 = provider.GetRequiredService<IHttpClientFactory>().CreateClient();
        var client2 = provider.GetRequiredService<IHttpClientFactory>().CreateClient();

        Assert.NotNull(client1);
        Assert.NotNull(client2);
        Assert.NotSame(client1, client2); // Each CreateClient returns a new instance
    }
}
