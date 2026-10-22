using System.IO.Compression;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// FIX-03 / H-06：云备份必须真的包含数据库，且是**一致性快照**（SQLite 在线备份 API，含 WAL 已提交行），
/// DB 缺失时备份必须失败而不是静默产出"没有数据库的完整备份"；settings.json 必须脱敏。
/// 这些用例直接测 internal 的打包入口，不需要网盘鉴权。
/// </summary>
public class CloudBackupDatabaseTests : IDisposable
{
    private readonly string _dir;
    private readonly string _dbPath;
    private readonly SqliteConnection _liveConn;
    private readonly SqliteConnection _settingsConn;
    private readonly AppDbContext _db;
    private readonly SettingsService _settings;
    private readonly LogService _log;
    private readonly RecordingLogger<LogService> _logger;

    public CloudBackupDatabaseTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), $"tp-cloudbackup-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dir);

        // 源库：WAL 模式 + 一条只提交到 -wal 的行（连接保持打开 → 不 checkpoint）
        _dbPath = Path.Combine(_dir, "teamportal.db");
        _liveConn = new SqliteConnection($"Data Source={_dbPath}");
        _liveConn.Open();
        using (var cmd = _liveConn.CreateCommand())
        {
            cmd.CommandText = "PRAGMA journal_mode=WAL";
            cmd.ExecuteScalar();
            cmd.CommandText = "CREATE TABLE Items(Id INTEGER PRIMARY KEY, Name TEXT)";
            cmd.ExecuteNonQuery();
            cmd.CommandText = "INSERT INTO Items(Name) VALUES('wal-row')";
            cmd.ExecuteNonQuery();
        }

        // 设置库（内存 EF），给 SettingsService / LogService 用
        _settingsConn = new SqliteConnection("Data Source=:memory:");
        _settingsConn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_settingsConn).Options);
        _db.Database.EnsureCreated();
        var scopes = new TestScopeFactory(_db);
        _settings = new SettingsService(scopes);
        _logger = new RecordingLogger<LogService>();
        _log = new LogService(scopes, _logger, _settings);
    }

    public void Dispose()
    {
        try { _liveConn.Dispose(); } catch { /* best effort */ }
        try { _db.Dispose(); } catch { /* best effort */ }
        try { _settingsConn.Dispose(); } catch { /* best effort */ }
        try { Directory.Delete(_dir, true); } catch { /* best effort */ }
        GC.SuppressFinalize(this);
    }

    private static IConfiguration Config(string connectionString) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = connectionString,
        }).Build();

    private BaiduNetdiskService Service(string connectionString)
        => new(new HttpClient(), Config(connectionString), _log, _settings);

    [Fact]
    public async Task BackupZip_ContainsConsistentDatabaseSnapshot_IncludingWalRows()
    {
        var zipPath = Path.Combine(_dir, "backup.zip");
        await Service($"Data Source={_dbPath}").BuildBackupZipAsync(zipPath, DateTime.UtcNow);

        using var zip = ZipFile.OpenRead(zipPath);
        var dbEntry = zip.Entries.SingleOrDefault(e => e.FullName == "teamportal.db");
        Assert.NotNull(dbEntry);
        Assert.NotNull(zip.Entries.SingleOrDefault(e => e.FullName == "settings.json"));

        var extracted = Path.Combine(_dir, "extracted.db");
        dbEntry!.ExtractToFile(extracted);

        using var copy = new SqliteConnection($"Data Source={extracted}");
        copy.Open();
        using (var cmd = copy.CreateCommand())
        {
            // 该行只在源库 -wal 里：File.Copy 会丢，BackupDatabase 不会 → 证明用的是在线备份 API
            cmd.CommandText = "SELECT Name FROM Items";
            Assert.Equal("wal-row", cmd.ExecuteScalar());
        }
        using (var check = copy.CreateCommand())
        {
            check.CommandText = "PRAGMA integrity_check";
            Assert.Equal("ok", check.ExecuteScalar());
        }
    }

    [Fact]
    public async Task BackupZip_MissingDatabase_ThrowsAndLogsError()
    {
        var missing = Path.Combine(_dir, "definitely-missing.db");
        var zipPath = Path.Combine(_dir, "should-not-exist.zip");

        await Assert.ThrowsAsync<FileNotFoundException>(
            () => Service($"Data Source={missing}").BuildBackupZipAsync(zipPath, DateTime.UtcNow));

        Assert.Contains(_logger.Messages, m => m.Contains("ABORTED", StringComparison.Ordinal) && m.Contains("not found", StringComparison.Ordinal));
        Assert.False(File.Exists(zipPath));
    }

    [Fact]
    public async Task BackupZip_SettingsJson_RedactsSecrets_ButKeepsKeyNames()
    {
        const string aiSecret = "sk-live-secret-value";
        const string baiduSecret = "baidu-secret-value";
        _db.SystemSettings.AddRange(
            new SystemSetting { Key = "AI:ApiKey", Value = aiSecret, Category = "AI 服务" },
            new SystemSetting { Key = "Baidu:SecretKey", Value = baiduSecret, Category = "百度网盘" },
            new SystemSetting { Key = "Brand:TeamName", Value = "雏鹰之翼", Category = "品牌" });
        await _db.SaveChangesAsync();

        var zipPath = Path.Combine(_dir, "backup-settings.zip");
        await Service($"Data Source={_dbPath}").BuildBackupZipAsync(zipPath, DateTime.UtcNow);

        using var zip = ZipFile.OpenRead(zipPath);
        var entry = zip.Entries.Single(e => e.FullName == "settings.json");
        using var reader = new StreamReader(entry.Open());
        var json = await reader.ReadToEndAsync();

        Assert.DoesNotContain(aiSecret, json);
        Assert.DoesNotContain(baiduSecret, json);
        Assert.Contains("AI:ApiKey", json);        // 键名保留，便于恢复时知道缺哪项
        Assert.Contains("Baidu:SecretKey", json);
        Assert.Contains("***", json);
        Assert.Contains("雏鹰之翼", json);           // 非凭据值原样保留
        using (var doc = JsonDocument.Parse(json))   // 必须是合法 JSON
        {
            Assert.NotEmpty(doc.RootElement.EnumerateObject());
        }
    }

    [Fact]
    public void ResolveDatabasePath_RelativeConnectionString_IsAbsoluteUnderBaseDir()
    {
        var baseDir = Path.Combine(_dir, "app");
        var resolved = BaiduNetdiskService.ResolveDatabasePath(Config("Data Source=../../data/teamportal.db"), baseDir);

        Assert.True(Path.IsPathFullyQualified(resolved));
        Assert.Equal(Path.GetFullPath(Path.Combine(baseDir, "../../data/teamportal.db")), resolved);
    }
}
