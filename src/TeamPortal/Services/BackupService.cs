using Microsoft.Data.Sqlite;

namespace TeamPortal.Services;

/// <summary>
/// Database backup and disaster recovery service.
/// - Automated backups every 6 hours with integrity verification
/// - Manual backup via admin API
/// - Fast one-click restore from any backup
/// - Auto-recovery on startup if DB is missing or corrupted
/// </summary>
public class BackupService
{
    private readonly IConfiguration _config;
    private readonly IWebHostEnvironment _env;
    private readonly LogService _log;
    private readonly string _dbPath;
    private readonly string _backupDir;
    private readonly bool _isDocker;

    public BackupService(IConfiguration config, IWebHostEnvironment env, LogService log)
    {
        _config = config;
        _env = env;
        _log = log;
        _isDocker = Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true";

        // Resolve DB path from connection string
        var connStr = _config.GetConnectionString("DefaultConnection") ?? "Data Source=data/teamportal.db";
        var dataSource = ParseDataSource(connStr);
        _dbPath = Path.IsPathFullyQualified(dataSource)
            ? dataSource
            : Path.GetFullPath(Path.Combine(_env.ContentRootPath, dataSource));

        _backupDir = Path.Combine(Path.GetDirectoryName(_dbPath)!, "backups", "db");
    }

    /// <summary>Parse Data Source from connection string.</summary>
    private static string ParseDataSource(string connStr)
    {
        foreach (var part in connStr.Split(';', StringSplitOptions.TrimEntries))
        {
            if (part.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase))
                return part["Data Source=".Length..];
        }
        return "data/teamportal.db";
    }

    // ════════════════════════════════════════
    //  Backup
    // ════════════════════════════════════════

    /// <summary>
    /// Create a verified backup of the current database.
    /// Uses SQLite's online backup API for consistency with active writers.
    /// Returns the backup file path on success.
    /// </summary>
    public async Task<string> CreateBackup(string tag = "auto")
    {
        Directory.CreateDirectory(_backupDir);

        var timestamp = DateTime.UtcNow.AddHours(8).ToString("yyyyMMdd-HHmmss"); // 北京时间(UTC+8)，与前端显示的本地时间一致
        var backupPath = Path.Combine(_backupDir, $"{timestamp}_{tag}.db");

        _log.Info("backup", $"Creating backup: {Path.GetFileName(backupPath)}");

        // SQLite online backup — safe with active connections
        await Task.Run(() => BackupDatabase(_dbPath, backupPath));

        var size = new FileInfo(backupPath).Length;
        _log.Info("backup", $"Backup created: {Path.GetFileName(backupPath)} ({size / 1024}KB)");

        // Verify integrity
        var ok = await VerifyBackup(backupPath);
        if (!ok)
        {
            File.Delete(backupPath);
            _log.Error("backup", $"Backup integrity check FAILED, deleted: {Path.GetFileName(backupPath)}");
            throw new InvalidOperationException("备份完整性校验失败，备份已删除");
        }

        // Update latest pointer
        var latestFile = Path.Combine(_backupDir, "latest.txt");
        await File.WriteAllTextAsync(latestFile, Path.GetFileName(backupPath));

        // Rotate old auto backups (keep last 24)
        await RotateBackups();

        _log.Info("backup", $"Backup verified OK: {Path.GetFileName(backupPath)}");
        return backupPath;
    }

    /// <summary>Get the latest backup file path, or null if none.</summary>
    public string? GetLatestBackup()
    {
        var latestFile = Path.Combine(_backupDir, "latest.txt");
        if (!File.Exists(latestFile)) return null;

        var name = File.ReadAllText(latestFile).Trim();
        var path = Path.Combine(_backupDir, name);
        return File.Exists(path) ? path : null;
    }

    /// <summary>List all available backups with metadata.</summary>
    public List<BackupInfo> ListBackups()
    {
        if (!Directory.Exists(_backupDir)) return new();

        return Directory.GetFiles(_backupDir, "*.db")
            .Select(f =>
            {
                var fi = new FileInfo(f);
                var name = Path.GetFileNameWithoutExtension(f);
                var parts = name.Split('_', 2);
                var tag = parts.Length > 1 ? parts[1] : "auto";
                return new BackupInfo
                {
                    FileName = Path.GetFileName(f),
                    Tag = tag,
                    SizeBytes = fi.Length,
                    CreatedAt = fi.CreationTime,
                };
            })
            .OrderByDescending(b => b.CreatedAt)
            .ToList();
    }

    // ════════════════════════════════════════
    //  Restore
    // ════════════════════════════════════════

    /// <summary>
    /// Restore database from a backup file.
    /// Creates a safety backup of the current DB before overwriting.
    /// Returns true on success. App restart is required to pick up the restored DB.
    /// </summary>
    public async Task<bool> Restore(string backupFileName, bool createSafetyBackup = true)
    {
        var backupPath = Path.Combine(_backupDir, backupFileName);
        if (!File.Exists(backupPath))
        {
            _log.Error("backup", $"Restore failed: backup not found {backupFileName}");
            return false;
        }

        // Verify backup integrity before restoring
        var ok = await VerifyBackup(backupPath);
        if (!ok)
        {
            _log.Error("backup", $"Restore ABORTED: backup {backupFileName} is corrupted");
            return false;
        }

        // Create safety backup of current DB (in case restore goes wrong)
        if (createSafetyBackup && File.Exists(_dbPath))
        {
            var safetyPath = _dbPath + $".before-restore-{DateTime.Now:yyyyMMddHHmmss}.bak";
            File.Copy(_dbPath, safetyPath, overwrite: true);
            _log.Info("backup", $"Safety backup saved: {Path.GetFileName(safetyPath)}");
        }

        // Restore via SQLite online backup API — handles WAL correctly,
        // unlike File.Copy which leaves a stale -wal that replays pre-restore writes on restart
        // (and File.Delete on -wal fails while the app's own connection holds the lock).
        await Task.Run(() => RestoreDatabase(backupPath, _dbPath));

        _log.Warn("backup", $"Database restored from {backupFileName}. App restart required.");

        return true;
    }

    /// <summary>
    /// Delete a backup file. Won't delete the latest successful backup.
    /// </summary>
    public bool DeleteBackup(string fileName)
    {
        // 校验 fileName 解析后在 _backupDir 内（防 ../ 逃逸到上级目录删任意文件）
        if (string.IsNullOrWhiteSpace(fileName)) return false;
        var path = Path.GetFullPath(Path.Combine(_backupDir, fileName));
        var normDir = Path.GetFullPath(_backupDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normPath = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (!normPath.StartsWith(normDir, StringComparison.OrdinalIgnoreCase) || normPath == normDir)
        {
            _log.Warn("backup", $"拒绝删除越界备份: {fileName}");
            return false;
        }
        if (!File.Exists(path)) return false;

        var latest = GetLatestBackup();
        if (latest is not null && Path.GetFileName(latest) == fileName)
        {
            _log.Warn("backup", $"Refusing to delete latest backup: {fileName}");
            return false;
        }

        // 软删除：移到回收目录，可恢复（回收站）
        var trashDir = Path.Combine(Path.GetDirectoryName(_backupDir)!, "trash");
        Directory.CreateDirectory(trashDir);
        var dest = Path.Combine(trashDir, fileName);
        if (File.Exists(dest)) File.Delete(dest);
        File.Move(path, dest);
        _log.Info("backup", $"Backup moved to trash: {fileName}");
        return true;
    }

    /// <summary>从回收目录还原备份文件。</summary>
    public bool RestoreBackupFromTrash(string fileName)
    {
        var trashDir = Path.Combine(Path.GetDirectoryName(_backupDir)!, "trash");
        var src = Path.Combine(trashDir, fileName);
        if (!File.Exists(src)) return false;
        var dest = Path.Combine(_backupDir, fileName);
        if (File.Exists(dest)) File.Delete(dest);
        File.Move(src, dest);
        _log.Info("backup", $"Backup restored from trash: {fileName}");
        return true;
    }

    /// <summary>彻底删除回收站里的备份文件。</summary>
    public bool DeleteBackupForever(string fileName)
    {
        var trashDir = Path.Combine(Path.GetDirectoryName(_backupDir)!, "trash");
        var src = Path.Combine(trashDir, fileName);
        if (!File.Exists(src)) return false;
        File.Delete(src);
        _log.Info("backup", $"Backup deleted forever: {fileName}");
        return true;
    }

    // ════════════════════════════════════════
    //  Auto-Recovery (called on startup)
    // ════════════════════════════════════════

    /// <summary>
    /// Check if database exists and is healthy. If not, auto-restore from latest backup.
    /// Called once at application startup before EF Core initialization.
    /// Returns diagnostic message.
    /// </summary>
    public StartupDbResult CheckAndRecoverOnStartup()
    {
        if (!File.Exists(_dbPath))
        {
            _log.Warn("backup", $"Database file not found: {_dbPath}");
            return TryAutoRecover("Database file missing");
        }

        // Quick integrity check on existing DB
        try
        {
            var ok = VerifyCurrentDbQuick();
            if (!ok)
            {
                _log.Error("backup", "Database integrity check FAILED, attempting auto-recovery...");
                return TryAutoRecover("Database corrupted");
            }
        }
        catch (Exception ex)
        {
            _log.Error("backup", $"Database check failed: {ex.Message}");
            return TryAutoRecover($"Database unreadable: {ex.Message}");
        }

        return new StartupDbResult { Healthy = true, Message = "Database OK" };
    }

    private StartupDbResult TryAutoRecover(string reason)
    {
        var latest = GetLatestBackup();
        if (latest is null)
        {
            _log.Error("backup", $"Auto-recovery FAILED: {reason}, no backup available. Creating new DB.");
            return new StartupDbResult { Healthy = false, Recovered = false, Message = $"{reason} — no backup, starting fresh" };
        }

        // 关键: 释放 Microsoft.Data.Sqlite 连接池持有的文件句柄,
        // 否则下面的 File.Move/File.Copy 会因 "file being used by another process" 失败。
        SqliteConnection.ClearAllPools();

        // Move corrupted DB aside (don't delete — keep for forensics)
        // -wal/-shm 也要一起移走,否则新 DB 会复用旧 WAL,导致恢复无效(旧数据复活)。
        if (File.Exists(_dbPath))
        {
            var corruptPath = _dbPath + ".corrupted";
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                var f = _dbPath + suffix;
                if (File.Exists(f))
                {
                    try { File.Move(f, corruptPath + suffix, overwrite: true); }
                    catch (Exception ex) { _log.Warn("backup", $"Failed to move {Path.GetFileName(f)}: {ex.Message}"); }
                }
            }
            _log.Warn("backup", $"Corrupted DB saved as: {Path.GetFileName(corruptPath)}");
        }

        File.Copy(latest, _dbPath);

        // 防御: 如果主文件缺失但旧 -wal/-shm 残留,清掉避免污染新库
        foreach (var suffix in new[] { "-wal", "-shm" })
        {
            var f = _dbPath + suffix;
            if (File.Exists(f))
            {
                try { File.Delete(f); }
                catch { /* best effort */ }
            }
        }

        _log.Warn("backup", $"Auto-recovery: restored from {Path.GetFileName(latest)}");
        return new StartupDbResult
        {
            Healthy = true,
            Recovered = true,
            Message = $"Auto-recovered from {Path.GetFileName(latest)} ({reason})"
        };
    }

    // ════════════════════════════════════════
    //  Integrity Verification
    // ════════════════════════════════════════

    /// <summary>Verify a backup file using PRAGMA integrity_check.</summary>
    public async Task<bool> VerifyBackup(string backupPath)
    {
        try
        {
            return await Task.Run(() =>
            {
                using var conn = new SqliteConnection($"Data Source={backupPath}");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "PRAGMA integrity_check";
                var result = cmd.ExecuteScalar()?.ToString();
                return result == "ok";
            });
        }
        catch (Exception ex)
        {
            _log.Error("backup", $"Integrity check failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>Quick check of the current (live) database.</summary>
    private bool VerifyCurrentDbQuick()
    {
        try
        {
            using var conn = new SqliteConnection($"Data Source={_dbPath}");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "PRAGMA quick_check";
            cmd.CommandTimeout = 5;
            var result = cmd.ExecuteScalar()?.ToString();
            return result == "ok";
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Get backup statistics.</summary>
    public object GetStats()
    {
        var latest = GetLatestBackup();
        var backups = ListBackups();
        return new
        {
            dbPath = _dbPath,
            dbExists = File.Exists(_dbPath),
            dbSize = File.Exists(_dbPath) ? new FileInfo(_dbPath).Length : 0,
            backupCount = backups.Count,
            latestBackup = latest is not null ? Path.GetFileName(latest) : null,
            latestBackupAge = latest is not null
                ? $"{(DateTime.Now - File.GetCreationTime(latest)).TotalHours:F1}h ago"
                : "never",
            backupDir = _backupDir,
            backups = backups.Take(10).Select(b => new
            {
                b.FileName,
                b.Tag,
                sizeKb = b.SizeBytes / 1024,
                b.CreatedAt,
            }),
        };
    }

    // ════════════════════════════════════════
    //  Internals
    // ════════════════════════════════════════

    /// <summary>Use SQLite backup API for a consistent snapshot.</summary>
    private static void BackupDatabase(string sourcePath, string destPath)
    {
        using var source = new SqliteConnection($"Data Source={sourcePath}");
        using var dest = new SqliteConnection($"Data Source={destPath}");
        source.Open();
        dest.Open();
        source.BackupDatabase(dest);
    }

    /// <summary>Restore from a backup file into the live DB via the SQLite backup API.
    /// Unlike File.Copy, this correctly checkpoints/rewrites the live WAL so no stale
    /// pre-restore writes survive a restart.</summary>
    private static void RestoreDatabase(string backupPath, string dbPath)
    {
        using var source = new SqliteConnection($"Data Source={backupPath}");
        using var dest = new SqliteConnection($"Data Source={dbPath}");
        source.Open();
        dest.Open();
        source.BackupDatabase(dest);
    }

    /// <summary>Keep only the last 24 auto backups. Manual backups are kept indefinitely.</summary>
    private async Task RotateBackups()
    {
        var autoBackups = Directory.GetFiles(_backupDir, "*_auto.db")
            .OrderByDescending(f => f)
            .Skip(24)
            .ToList();

        foreach (var f in autoBackups)
        {
            try { File.Delete(f); }
            catch { /* can't delete — skip */ }
        }

        if (autoBackups.Count > 0)
            _log.Info("backup", $"Rotated {autoBackups.Count} old auto backup(s)");
        await Task.CompletedTask;
    }
}

public class BackupInfo
{
    public string FileName { get; set; } = "";
    public string Tag { get; set; } = "auto";
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class StartupDbResult
{
    public bool Healthy { get; set; }
    public bool Recovered { get; set; }
    public string Message { get; set; } = "";
}
