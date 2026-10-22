using System.IO.Compression;
using System.Text;

namespace TeamPortal.Services;

/// <summary>
/// BaiduNetdiskService 的备份部分：系统完整备份打包上传、初始化网盘文件夹结构。
///
/// H-06 修复：
///  - 数据库路径从连接串解析（容器里是 /data/teamportal.db，旧实现拼 cwd/data/... 会静默漏掉数据库）；
///  - 快照改用 SQLite 在线备份 API，包含源库 WAL 中已提交的数据（File.Copy 会漏）；
///  - DB 缺失/快照失败必须抛错让本次备份失败，绝不产出"没有数据库的完整备份"；
///  - settings.json 入 zip 前对 Key/Secret/Password/Token 一类字段脱敏（保留键名，值替换为 ***）。
/// </summary>
public partial class BaiduNetdiskService
{
    /// <summary>
    /// 生成备份 zip（数据库快照 + 脱敏 settings + 知识库）。
    /// DB 不存在或快照失败直接抛出，由 BackupSystem 转成失败备份。
    /// 独立成 internal 便于单测（不需要网盘鉴权）。
    /// </summary>
    internal async Task<string> BuildBackupZipAsync(string zipPath, DateTime at, CancellationToken ct = default)
    {
        var baseDir = Directory.GetCurrentDirectory();
        var dbPath = ResolveDatabasePath(_config, baseDir);
        if (!File.Exists(dbPath))
        {
            _log.Error("baidu", $"System backup ABORTED: database not found: {dbPath}");
            throw new FileNotFoundException($"备份失败：数据库文件不存在（{dbPath}）", dbPath);
        }

        var dataRoot = ResolveDataRoot(baseDir);
        var tmpDb = Path.Combine(Path.GetTempPath(), $"backup-db-{at:yyyyMMddHHmmss}-{Guid.NewGuid():N}.db");
        try
        {
            SnapshotDatabase(dbPath, tmpDb);
            var size = new FileInfo(tmpDb).Length;
            if (size == 0) throw new InvalidOperationException($"数据库快照为空（{dbPath}）");

            using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
            zip.CreateEntryFromFile(tmpDb, "teamportal.db");
            _log.Info("baidu", $"Backup: DB snapshot ({size} bytes) from {dbPath}");

            var settingsJson = SerializeSettingsRedacted(await _settings.GetAllGrouped());
            var entry = zip.CreateEntry("settings.json");
            await using (var writer = new StreamWriter(entry.Open(), Encoding.UTF8))
                await writer.WriteAsync(settingsJson);
            _log.Info("baidu", "Backup: settings (secrets redacted)");

            AddDirectoryToZip(zip, Path.Combine(dataRoot, "knowledge"), "knowledge/");
        }
        finally
        {
            try { if (File.Exists(tmpDb)) File.Delete(tmpDb); } catch { /* 尽力而为 */ }
        }

        return zipPath;
    }

    /// <summary>创建系统完整备份并上传到百度网盘；本地兜底副本写到 data/backups。</summary>
    public async Task<string> BackupSystem(CancellationToken ct = default)
    {
        await GetAccessToken(ct); // ensure auth
        var at = DateTime.Now;
        var timestamp = at.ToString("yyyyMMdd-HHmmss");
        var zipName = $"backup-{timestamp}.zip";
        var zipPath = Path.Combine(Path.GetTempPath(), zipName);
        var remotePath = $"{RootDir}/system/backups/{zipName}";

        _log.Info("baidu", $"System backup start: {zipName}");

        try
        {
            await BuildBackupZipAsync(zipPath, at, ct);
        }
        catch (Exception ex)
        {
            try { if (File.Exists(zipPath)) File.Delete(zipPath); } catch { /* 尽力而为 */ }
            _log.Error("baidu", $"System backup FAILED: {ex.Message}");
            throw;
        }

        var zipSize = new FileInfo(zipPath).Length;
        _log.Info("baidu", $"Backup zip: {zipSize} bytes");

        // Upload zip to cloud (fallback: save locally)
        try
        {
            await UploadFile(zipPath, remotePath, null, ct);
        }
        catch (Exception ex)
        {
            _log.Error("baidu", $"Backup upload failed, keeping local copy: {ex.Message}");
            var localBackupDir = Path.Combine(ResolveDataRoot(Directory.GetCurrentDirectory()), "backups");
            Directory.CreateDirectory(localBackupDir);
            var localPath = Path.Combine(localBackupDir, zipName);
            File.Copy(zipPath, localPath, true);
            File.Delete(zipPath);
            return localPath;
        }

        File.Delete(zipPath);
        _log.Info("baidu", $"System backup OK: {remotePath}");
        return remotePath;
    }

    /// <summary>Recursively add a directory to a zip archive. Returns file count added.</summary>
    private int AddDirectoryToZip(ZipArchive zip, string sourceDir, string entryPrefix)
    {
        if (!Directory.Exists(sourceDir)) return 0;
        var files = Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories);
        foreach (var file in files)
        {
            var relativePath = Path.GetRelativePath(sourceDir, file).Replace('\\', '/');
            zip.CreateEntryFromFile(file, entryPrefix + relativePath);
        }
        if (files.Length > 0)
            _log.Info("baidu", $"Backup: {entryPrefix.TrimEnd('/')} ({files.Length} files)");
        return files.Length;
    }

    /// <summary>
    /// 一键创建系统所需的完整文件夹结构。
    /// /apps/team-portal/
    /// ├── system/
    /// │   ├── backups/
    /// │   ├── logs/
    /// │   └── configs/
    /// └── user-data/
    ///     ├── flight-logs/
    ///     ├── photos-videos/
    ///     └── documents/
    /// </summary>
    public async Task EnsureFolderStructure(CancellationToken ct = default)
    {
        // Create parent dirs first, then children (API doesn't auto-create parents)
        var dirs = new[]
        {
            $"{RootDir}/system",
            $"{RootDir}/user-data",
            $"{RootDir}/system/backups",
            $"{RootDir}/system/logs",
            $"{RootDir}/system/configs",
            $"{RootDir}/user-data/flight-logs",
            $"{RootDir}/user-data/photos-videos",
            $"{RootDir}/user-data/documents",
        };

        _log.Info("baidu", $"EnsureFolderStructure: creating {dirs.Length} directories...");
        int created = 0, existed = 0;

        foreach (var dir in dirs)
        {
            if (await CreateDirectory(dir, ct))
                created++;
            else
                existed++;
        }

        _log.Info("baidu", $"Folder structure done: {created} created, {existed} existed");
    }
}
