using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Options;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 固件下载的超时配置。回归的原始缺陷：弹性管道的默认 TotalRequestTimeout 是 30s，
/// 会把慢速固件下载直接掐断（现象：502 + "The operation was canceled."，恰好 30006ms），
/// 而国内服务器拉 GitHub 资产超过 30s 是常态 —— 用户侧最终看到的是 Next 反代的 500。
/// </summary>
public class FirmwareTimeoutConfigurationTests
{
    private static ServiceProvider Build()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddFirmwareServices();
        return services.BuildServiceProvider();
    }

    [Fact]
    public void DownloadClient_LeavesTimeoutToDownloadBudget_NotHttpClient()
    {
        var client = Build().GetRequiredService<IHttpClientFactory>()
            .CreateClient(FirmwareServices.DownloadClientName);

        // 必须无限：否则 HttpClient 默认的 100s 会和 DownloadTimeout 叠加出更短的上限
        Assert.Equal(Timeout.InfiniteTimeSpan, client.Timeout);
    }

    [Fact]
    public void DownloadClient_ResilienceCapIsFarAboveTheThirtySecondDefault()
    {
        var options = Build().GetRequiredService<IOptionsMonitor<HttpStandardResilienceOptions>>()
            .Get(FirmwareServices.DownloadResilienceOptionsName);

        Assert.True(
            options.TotalRequestTimeout.Timeout > TimeSpan.FromMinutes(5),
            $"下载客户端的总超时仍只有 {options.TotalRequestTimeout.Timeout}，慢速下载会被掐断");
        Assert.True(
            options.AttemptTimeout.Timeout > TimeSpan.FromMinutes(1),
            $"单次尝试超时仍只有 {options.AttemptTimeout.Timeout}");
    }

    [Fact]
    public void CatalogClient_KeepsDefaultResiliencePolicy()
    {
        var client = Build().GetRequiredService<IHttpClientFactory>()
            .CreateClient(nameof(FirmwareCatalogService));

        // 目录查询是小 JSON，保留 HttpClient 默认超时即可（与前两者区分开）
        Assert.Equal(TimeSpan.FromSeconds(100), client.Timeout);
    }
}
