namespace TeamPortal.Services;

/// <summary>
/// Background worker for scheduled maintenance:
/// - Daily system backup (DB + settings → Baidu cloud)
/// - Daily log archiving (export old logs → cloud, then cleanup)
/// Runs at 3:00 AM daily, or every 24h from startup if time already passed.
/// </summary>
public class MaintenanceWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MaintenanceWorker> _logger;

    public MaintenanceWorker(IServiceScopeFactory scopeFactory, ILogger<MaintenanceWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Maintenance worker started (daily backup + log archive)");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); // Brief startup delay

                var delay = GetDelayUntilNextRun();
                _logger.LogInformation("Maintenance: next run in {Hours:F1} hours", delay.TotalHours);

                await Task.Delay(delay, stoppingToken);

                using var scope = _scopeFactory.CreateScope();
                var baidu = scope.ServiceProvider.GetRequiredService<BaiduNetdiskService>();
                var logSvc = scope.ServiceProvider.GetRequiredService<LogService>();

                if (!await baidu.IsConfigured())
                {
                    _logger.LogWarning("Maintenance: Baidu Netdisk not configured, skipping");
                    continue;
                }

                // 1. System backup
                try
                {
                    var backupPath = await baidu.BackupSystem();
                    _logger.LogInformation("Maintenance: backup → {Path}", backupPath);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Maintenance: backup failed");
                }

                // 2. Log archive + cleanup
                try
                {
                    var csv = await logSvc.ExportCsv(level: null, from: null, to: null);
                    var csvBytes = System.Text.Encoding.UTF8.GetBytes(csv);
                    var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                    var tmpPath = Path.Combine(Path.GetTempPath(), $"auto-logs-{timestamp}.csv");
                    await File.WriteAllBytesAsync(tmpPath, csvBytes);

                    var remotePath = $"{BaiduNetdiskService.RootDir}/system/logs/logs-{timestamp}.csv";
                    await baidu.UploadFile(tmpPath, remotePath);
                    File.Delete(tmpPath);

                    // Cleanup old logs (keep 90 days)
                    var deleted = await logSvc.CleanupOldLogs();
                    _logger.LogInformation("Maintenance: archived logs to {Path}, cleaned {Count} old entries", remotePath, deleted);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Maintenance: log archive failed");
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Maintenance worker error");
            }
        }
    }

    /// <summary>Calculate delay until next 3:00 AM. If already past, next day.</summary>
    private static TimeSpan GetDelayUntilNextRun()
    {
        var now = DateTime.UtcNow;
        var next = now.Date.AddHours(3);
        if (next <= now)
            next = next.AddDays(1);
        // Add small random offset (±15 min) to avoid thundering herd
        var jitter = Random.Shared.Next(-15, 16);
        return next.AddMinutes(jitter) - now;
    }
}
