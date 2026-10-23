using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// Background worker for scheduled maintenance:
/// - DB-only backup every 6 hours (verified, rotated)
/// - Daily system backup (DB + settings → Baidu cloud)
/// - Daily log archiving (export old logs → cloud, then cleanup)
/// - Daily TLS certificate expiry check (HTTPS/HTTP3 上线后证书是硬依赖，提前预警)
/// - Temp source-ZIP sweep every hour (审计 M-11：上传的源码包默认永不清理，会慢慢占满容器磁盘)
/// </summary>
public class MaintenanceWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MaintenanceWorker> _logger;
    private readonly IConfiguration _configuration;

    public MaintenanceWorker(IServiceScopeFactory scopeFactory, ILogger<MaintenanceWorker> logger, IConfiguration configuration)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _configuration = configuration;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Maintenance worker started (DB backup 6h + daily cloud backup + log archive)");

        var lastDbBackup = DateTime.MinValue;
        // 临时源码 ZIP 清扫的节流：失败也等一小时再试，避免每 5 分钟刷一条日志
        var lastZipSweep = DateTime.MinValue;
        // 每日任务「今天(北京时间)是否已经做过」。判据必须是日期而不是「距上次运行 23 小时」：
        // 后者在每次容器重启时(每次部署都会重启)都会立刻重跑一遍每日任务，而每日备份文件
        // 此前不参与轮转 —— 线上因此攒出 177 份备份(约 1.8GB)、磁盘用到 85%。
        // 启动时先读磁盘上最新一份每日备份的日期，重启就不再重复生成。
        string? lastDailyDate = null;
        try
        {
            using var probeScope = _scopeFactory.CreateScope();
            lastDailyDate = probeScope.ServiceProvider.GetRequiredService<BackupService>().LastBackupDate("daily");
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Maintenance: 读取上次每日备份日期失败，本轮按未做过处理"); }

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

                // ── 临时源码 ZIP 清扫（审计 M-11）：每小时一次 ──
                // 上传的 ZIP 不能提交后立刻删（retry-missing / reclone 还要用），所以按保留期清理；
                // 任务被删除时由 WikiEndpoints 立刻删掉，这里只兜住"没人删的任务"。
                if (now - lastZipSweep >= TimeSpan.FromHours(1))
                {
                    lastZipSweep = now;
                    try
                    {
                        var removedZips = SafeZipExtractor.CleanupOldArchives();
                        if (removedZips > 0)
                            _logger.LogInformation("Maintenance: removed {Count} expired temp source ZIP(s) (retention {Days} days)",
                                removedZips, SafeZipExtractor.DefaultArchiveRetention.TotalDays);
                    }
                    catch (Exception ex) { _logger.LogWarning(ex, "Maintenance: temp source ZIP cleanup failed"); }
                }

                // ── Daily: cloud backup + log archive, 每天凌晨 3 点(北京时间)后第一次检查时执行 ──
                var todayBeijing = DateTime.UtcNow.AddHours(8).ToString("yyyyMMdd");

                if (ShouldRunDaily(DateTime.UtcNow, lastDailyDate))
                {
                    lastDailyDate = todayBeijing;
                    using var scope = _scopeFactory.CreateScope();
                    var baidu = scope.ServiceProvider.GetRequiredService<BaiduNetdiskService>();
                    var logSvc = scope.ServiceProvider.GetRequiredService<LogService>();
                    var archiver = scope.ServiceProvider.GetRequiredService<LogArchiver>();
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
                        catch (Exception ex)
                        {
                            // 自动云端备份的失败原本只进 ILogger(控制台)，系统日志页看不到，
                            // 管理员只能看到手动备份那条「Backup upload failed」——补一条可查的留痕。
                            _logger.LogError(ex, "Maintenance: cloud backup failed");
                            logSvc.Warn("backup", $"云端备份失败（本地备份已生成，不受影响）：{ex.Message}");
                        }
                    }

                    // 3. 日志归档 + 清理：先落本地 CSV（无网盘也执行），再只清理已归档的行。
                    //    归档失败 → 传 null → 该表跳过清理，绝不出现「删了却没归档」。
                    try
                    {
                        var outcome = await archiver.ArchiveExpiredAsync();
                        if (outcome.System.MaxId is null && outcome.Operation.MaxId is null)
                        {
                            _logger.LogInformation("Maintenance: no expired logs to archive");
                        }
                        else
                        {
                            var cleaned = await logSvc.CleanupOldLogs(outcome.System.MaxId, outcome.Operation.MaxId,
                                outcome.System.Path, outcome.Operation.Path, "maintenance-worker");
                            _logger.LogInformation(
                                "Maintenance: archived {Sys}+{Op} logs, cleaned {CS}+{CO} (local → {Dir})",
                                outcome.System.Count, outcome.Operation.Count, cleaned.SystemDeleted, cleaned.OperationDeleted, outcome.System.Path);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Maintenance: log archive failed — cleanup skipped for this run");
                    }

                    // 4. 数据库完整性自检（每日一次，只诊断不修复）
                    try
                    {
                        using var integrityScope = _scopeFactory.CreateScope();
                        var db = integrityScope.ServiceProvider.GetRequiredService<AppDbContext>();
                        var (integrity, fkViolations) = await DbIntegrityCheck.RunAsync(db);
                        if (integrity == "ok" && fkViolations == 0)
                            logSvc.Info("database", "数据库完整性自检通过：integrity_check=ok, foreign_key_check=0 违规");
                        else
                            logSvc.Error("database", $"数据库完整性自检异常：integrity_check={integrity}, foreign_key_check={fkViolations} 违规");
                    }
                    catch (Exception ex)
                    {
                        logSvc.Error("database", $"数据库完整性自检失败：{ex.Message}");
                    }

                    // 5. TLS 证书到期检查（每日一次）：Tls:CertPath 默认空 → 跳过；
                    //    证书文件缺失/解析失败由 TlsCertMonitor 内部记 warn，不抛出，不影响其它维护任务。
                    TlsCertMonitor.Check(logSvc, _configuration["Tls:CertPath"]);
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

    /// <summary>
    /// 每日任务(云端备份 + 日志归档)是否该跑：北京时间 3 点之后，且今天还没跑过。
    ///
    /// 判据必须是「日期」而不是「距上次运行满 23 小时」：容器每次部署都会重启，
    /// 重启后内存里的计时归零，后者会让每日任务立刻重跑一遍 —— 每日备份文件又从不轮转，
    /// 线上因此攒出 177 份备份(约 1.8GB)把磁盘顶到 85%。
    /// </summary>
    /// <param name="utcNow">当前 UTC 时间</param>
    /// <param name="lastDailyDate">磁盘上最新一份每日备份的日期(yyyyMMdd,北京时间)；null = 没做过</param>
    internal static bool ShouldRunDaily(DateTime utcNow, string? lastDailyDate)
    {
        var beijing = utcNow.AddHours(8);
        return beijing.Hour >= 3 && lastDailyDate != beijing.ToString("yyyyMMdd");
    }
}
