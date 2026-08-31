using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// BaiduNetdiskService 的备份部分：系统完整备份打包上传、初始化网盘文件夹结构。
/// </summary>
public partial class BaiduNetdiskService
{
    /// <summary>
    /// 创建系统完整备份并上传到百度网盘。
    /// 备份内容：SQLite 数据库 + 系统设置 + 知识库 + Wiki 文档 + 飞行日志。
    /// </summary>
    /// <returns>网盘中的备份文件路径</returns>
    public async Task<string> BackupSystem()
    {
        await GetAccessToken(); // ensure auth
        var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var zipName = $"backup-{timestamp}.zip";
        var zipPath = Path.Combine(Path.GetTempPath(), zipName);
        var remotePath = $"{RootDir}/system/backups/{zipName}";

        _log.Info("baidu", $"System backup start: {zipName}");

        var contentRoot = Directory.GetCurrentDirectory();
        var dbPath = Path.Combine(contentRoot, "data", "teamportal.db");
        var dataDir = Path.GetFullPath(Path.Combine(contentRoot, "..", "..", "data"));

        using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
        {
            // 1. SQLite database snapshot
            if (File.Exists(dbPath))
            {
                var tmpDb = Path.Combine(Path.GetTempPath(), $"backup-db-{timestamp}.db");
                File.Copy(dbPath, tmpDb, true);
                zip.CreateEntryFromFile(tmpDb, "teamportal.db");
                File.Delete(tmpDb);
                _log.Info("baidu", $"Backup: DB ({new FileInfo(dbPath).Length} bytes)");
            }

            // 2. System settings as JSON
            var settings = await _settings.GetAllGrouped();
            var settingsJson = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
            var entry = zip.CreateEntry("settings.json");
            using (var writer = new StreamWriter(entry.Open(), Encoding.UTF8))
                await writer.WriteAsync(settingsJson);
            _log.Info("baidu", "Backup: settings");

            // 3. Knowledge base + Wiki documents
            AddDirectoryToZip(zip, Path.Combine(dataDir, "knowledge"), "knowledge/");

            // 4. Flight logs
            AddDirectoryToZip(zip, Path.Combine(dataDir, "flightlogs"), "flightlogs/");
        }

        var zipSize = new FileInfo(zipPath).Length;
        _log.Info("baidu", $"Backup zip: {zipSize} bytes");

        // Upload zip to cloud (fallback: save locally)
        try
        {
            await UploadFile(zipPath, remotePath);
        }
        catch (Exception ex)
        {
            _log.Error("baidu", $"Backup upload failed, keeping local copy: {ex.Message}");
            var localBackupDir = Path.Combine(contentRoot, "data", "backups");
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
    public async Task EnsureFolderStructure()
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
            if (await CreateDirectory(dir))
                created++;
            else
                existed++;
        }

        _log.Info("baidu", $"Folder structure done: {created} created, {existed} already existed");
    }
}
