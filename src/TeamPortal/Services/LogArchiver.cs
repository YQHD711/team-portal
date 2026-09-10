namespace TeamPortal.Services;

/// <summary>归档结果：两表各自的归档情况；MaxId 为 null 表示该表本次没有可归档的行，调用方不得清理该表</summary>
public record LogArchiveOutcome(
    LogArchive System,
    LogArchive Operation,
    string? SystemRemote,
    string? OperationRemote);

/// <summary>
/// 日志归档编排：先把超期日志落成本地 CSV（**始终执行**，作为安全网），网盘已配置时再上传一份。
/// 返回的 MaxId 交给 <see cref="LogService.CleanupOldLogs"/> 做「只清理已归档行」，
/// 因此本地写盘失败时必须让异常冒泡（调用方据此跳过清理）。
/// </summary>
public class LogArchiver
{
    /// <summary>本地归档文件保留份数上限（防归档目录自身无限增长）</summary>
    public const int LocalKeepFiles = 200;

    private readonly LogService _logs;
    private readonly BaiduNetdiskService _baidu;
    private readonly SettingsService _settings;
    private readonly ILogger<LogArchiver> _logger;
    private readonly string _archiveDir;

    public LogArchiver(LogService logs, BaiduNetdiskService baidu, SettingsService settings,
        IConfiguration config, ILogger<LogArchiver> logger)
    {
        _logs = logs;
        _baidu = baidu;
        _settings = settings;
        _logger = logger;
        _archiveDir = config["Logs:ArchiveDir"] is { Length: > 0 } dir
            ? dir
            : Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "log-archive"));
    }

    /// <summary>归档两表中已超期的日志；返回各表已落盘的最大 Id 供清理使用</summary>
    public async Task<LogArchiveOutcome> ArchiveExpiredAsync(DateTime? now = null)
    {
        var at = now ?? DateTime.UtcNow;
        var stamp = at.ToString("yyyyMMdd-HHmmss");
        var sysDays = await _settings.GetInt("System:LogRetentionDays", 90);
        var opDays = await _settings.GetInt("System:OperationLogRetentionDays", 180);

        var sys = await _logs.ExportSystemLogsForArchive(
            at.AddDays(-sysDays), Path.Combine(_archiveDir, $"{stamp}-system-logs.csv"));
        var op = await _logs.ExportOperationsForArchive(
            at.AddDays(-opDays), Path.Combine(_archiveDir, $"{stamp}-operation-logs.csv"));

        string? sysRemote = null;
        string? opRemote = null;
        if (await _baidu.IsConfigured())
        {
            // 本地文件已落盘，网盘上传失败不影响「已归档」判定，只记警告
            sysRemote = await TryUploadAsync(sys, "system/logs");
            opRemote = await TryUploadAsync(op, "system/operation-logs");
        }

        RotateLocalArchives();
        _logger.LogInformation("LogArchiver: 归档 {Sys} 条请求日志 / {Op} 条操作日志 → {Dir}{Cloud}",
            sys.Count, op.Count, _archiveDir, sysRemote is null && opRemote is null ? "" : "（已上传网盘）");
        return new LogArchiveOutcome(sys, op, sysRemote, opRemote);
    }

    private async Task<string?> TryUploadAsync(LogArchive archive, string folder)
    {
        if (archive.MaxId is null) return null;
        try
        {
            return await _baidu.UploadFile(archive.Path, $"{BaiduNetdiskService.RootDir}/{folder}/{Path.GetFileName(archive.Path)}");
        }
        catch (Exception ex)
        {
            _logger.LogWarning("LogArchiver: 网盘上传失败（本地归档保留）: {Message}", ex.Message);
            return null;
        }
    }

    /// <summary>本地归档文件轮转：只保留最新 <see cref="LocalKeepFiles"/> 个，避免归档目录无限增长</summary>
    private void RotateLocalArchives()
    {
        try
        {
            if (!Directory.Exists(_archiveDir)) return;
            var stale = Directory.GetFiles(_archiveDir, "*.csv")
                .OrderByDescending(f => f)
                .Skip(LocalKeepFiles)
                .ToList();
            foreach (var f in stale) File.Delete(f);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("LogArchiver: 本地归档轮转失败: {Message}", ex.Message);
        }
    }
}
