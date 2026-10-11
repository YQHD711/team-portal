namespace TeamPortal.Services;

/// <summary>
/// P0-1 每日增量：给英文知识文档补中文摘要 sidecar。
///
/// 增量判据是文件 mtime（sidecar 不存在或比原文旧），所以**重启后重复跑也不会重复烧 token**——
/// 这也是这里不做「今天是否已跑过」日期判定的原因：跑一轮的全部成本只是 stat + 少量 AI 调用。
/// 单次上限 300 篇（见 <see cref="KnowledgeBridgingIndexService.MaxDocsPerRun"/>），
/// 大库要分几天铺完，需要时管理员可手动触发加速。
/// </summary>
public class KnowledgeBridgingWorker : BackgroundService
{
    /// <summary>启动后先等一会儿：避开启动期的迁移/种子/索引重建，别和它们抢 IO 与 token。</summary>
    public const int StartupDelayMinutes = 3;
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    private readonly KnowledgeBridgingIndexService _bridging;
    private readonly ILogger<KnowledgeBridgingWorker> _logger;

    public KnowledgeBridgingWorker(KnowledgeBridgingIndexService bridging, ILogger<KnowledgeBridgingWorker> logger)
    {
        _bridging = bridging;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Knowledge bridging worker started (daily incremental)");
        try { await Task.Delay(TimeSpan.FromMinutes(StartupDelayMinutes), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = await _bridging.RunAsync(force: false, stoppingToken);
                _logger.LogInformation("Knowledge bridging run finished: {Message}", result.Message);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Knowledge bridging run failed");
            }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
