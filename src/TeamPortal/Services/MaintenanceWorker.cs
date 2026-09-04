namespace TeamPortal.Services;

/// <summary>
/// Background worker for scheduled maintenance:
/// - DB-only backup every 6 hours (verified, rotated)
/// - Daily system backup (DB + settings → Baidu cloud)
/// - Daily log archiving (export old logs → cloud, then cleanup)
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
        _logger.LogInformation("Maintenance worker started (DB backup 6h + daily cloud backup + log archive)");

        var lastDbBackup = DateTime.MinValue;
        var lastDailyRun = DateTime.MinValue;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTime.UtcNow;

                // ── Local DB backup every 6 hours ──
                if (now - lastDbBackup >= TimeSpan.FromHours(6))
                {
                    await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); // Brief startup delay

                    using (var scope = _scopeFactory.CreateScope())
                    {
                        var backupSvc = scope.ServiceProvider.GetRequiredService<BackupService>();
                        try
                        {
                            await backupSvc.CreateBackup("auto");
                            lastDbBackup = DateTime.UtcNow;
                            _logger.LogInformation("Maintenance: DB backup completed");
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Maintenance: DB backup failed");
                        }
                    }
                }

                // ── Daily: cloud backup + log archive at ~3:00 AM ──
                var nextDaily = GetNextDailyRun();
                var timeToDaily = nextDaily - DateTime.UtcNow;

                if (timeToDaily <= TimeSpan.Zero || (DateTime.UtcNow - lastDailyRun >= TimeSpan.FromHours(23)))
                {
                    using var scope = _scopeFactory.CreateScope();
                    var baidu = scope.ServiceProvider.GetRequiredService<BaiduNetdiskService>();
                    var logSvc = scope.ServiceProvider.GetRequiredService<LogService>();
                    var backupSvc = scope.ServiceProvider.GetRequiredService<BackupService>();

                    // 1. DB backup (always, even without Baidu)
                    try
                    {
                        await backupSvc.CreateBackup("daily");
                        _logger.LogInformation("Maintenance: daily DB backup completed");
                    }
                    catch (Exception ex) { _logger.LogError(ex, "Maintenance: daily DB backup failed"); }

                    if (await baidu.IsConfigured())
                    {
                        // 2. Full system backup to Baidu cloud
                        try
                        {
                            var backupPath = await baidu.BackupSystem();
                            _logger.LogInformation("Maintenance: cloud backup → {Path}", backupPath);
                        }
                        catch (Exception ex) { _logger.LogError(ex, "Maintenance: cloud backup failed"); }

                        // 3. Log archive + cleanup
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

                            var deleted = await logSvc.CleanupOldLogs();
                            _logger.LogInformation("Maintenance: archived logs to {Path}, cleaned {Count} old entries", remotePath, deleted);
                        }
                        catch (Exception ex) { _logger.LogError(ex, "Maintenance: log archive failed"); }
                    }
                    else
                    {
                        // Log cleanup even without Baidu
                        try { await logSvc.CleanupOldLogs(); } catch { }
                    }

                    lastDailyRun = DateTime.UtcNow;
                }

                // Sleep until next check (re-check every 5 minutes)
                await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Maintenance worker error, retrying in 5 minutes");
                try { await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken); } catch { break; }
            }
        }
    }

    /// <summary>Calculate the next 3:00 AM UTC.</summary>
    private static DateTime GetNextDailyRun()
    {
        var now = DateTime.UtcNow;
        var next = now.Date.AddHours(3);
        if (next <= now) next = next.AddDays(1);
        return next.AddMinutes(Random.Shared.Next(-15, 16));
    }
}
