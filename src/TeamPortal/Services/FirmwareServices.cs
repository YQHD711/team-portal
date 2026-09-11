using Microsoft.Extensions.Http.Resilience;

namespace TeamPortal.Services;

/// <summary>
/// 固件代理的 DI 注册。抽成扩展方法是为了让测试能直接断言这套注册，
/// 而不必在测试里复刻一遍 Program.cs（复刻出来的副本会随时间漂移，测了等于没测）。
/// </summary>
public static class FirmwareServices
{
    /// <summary>下载客户端名（= 类型名），同时也是弹性管道选项名的前缀。</summary>
    public const string DownloadClientName = nameof(FirmwareCacheService);

    /// <summary>按客户端注册弹性管道时使用的选项名（约定为 "{ClientName}-standard"）。</summary>
    public const string DownloadResilienceOptionsName = DownloadClientName + "-standard";

    /// <summary>下载预算之外的兜底天花板；必须远大于 FirmwareCacheService.DownloadTimeout。</summary>
    public static readonly TimeSpan DownloadResilienceCeiling = TimeSpan.FromMinutes(30);

    public static IServiceCollection AddFirmwareServices(this IServiceCollection services)
    {
        services.AddMemoryCache();

        // 目录查询走默认弹性策略：小 JSON，重试/熔断是合理的。
        services.AddHttpClient<FirmwareCatalogService>();

        // 大文件下载则必须解除弹性管道的 30s 默认总超时 —— 它会把慢速下载直接掐断
        //（实测日志：Download failed ...: The operation was canceled. / 恰好 30006ms），
        // 而国内拉 GitHub 资产超过 30s 是常态。
        // Options 校验只接受 [10ms, 24h]，且要求 总超时 > 单次超时 ×（重试次数+1）、
        // 熔断采样窗口 ≥ 2×单次超时，故这几个值必须成组调整。
        // 真正的下载预算由 FirmwareCacheService.DownloadTimeout（默认 300s）通过
        // CancellationTokenSource 单独治理，这里只是管道层的兜底。
        services
            .AddHttpClient<FirmwareCacheService>(c => c.Timeout = System.Threading.Timeout.InfiniteTimeSpan)
            .AddStandardResilienceHandler(o =>
            {
                o.TotalRequestTimeout.Timeout = DownloadResilienceCeiling;
                o.AttemptTimeout.Timeout = TimeSpan.FromMinutes(10);
                o.CircuitBreaker.SamplingDuration = TimeSpan.FromMinutes(25);
                o.Retry.MaxRetryAttempts = 1;
                o.Retry.Delay = TimeSpan.FromSeconds(1);
            });

        return services;
    }
}
