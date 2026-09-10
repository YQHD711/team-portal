using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 日志归档 / 清理的不变量：只清理「已成功归档」的行。
/// 回归的原始缺陷：导出上限 10000 行而清理无上限 —— 超期日志被删却没进归档，
/// 且无网盘时也照常清理（审计数据永久丢失）。
/// </summary>
public class LogArchiveTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly string _dir;

    public LogArchiveTests()
    {
        var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        var scopes = new TestScopeFactory(_db);
        _settings = new SettingsService(scopes);
        _log = new LogService(scopes, NullLogger<LogService>.Instance, _settings);
        _dir = Path.Combine(Path.GetTempPath(), $"tp-logarchive-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { /* best effort */ }
        GC.SuppressFinalize(this);
    }

    private static SystemLog SysLog(int daysAgo, string message, string level = "info") => new()
    {
        Level = level, Category = "http", Message = message, Detail = "IP: 127.0.0.1",
        CreatedAt = DateTime.UtcNow.AddDays(-daysAgo),
    };

    private static OperationLog OpLog(int daysAgo, string action) => new()
    {
        UserName = "tester", Action = action, TargetType = "inventory", TargetId = "1",
        CreatedAt = DateTime.UtcNow.AddDays(-daysAgo),
    };

    private string Path1(string name) => Path.Combine(_dir, name);

    [Fact]
    public async Task Export_ContainsOnlyExpiredRows_AndReportsMaxId()
    {
        _db.SystemLogs.AddRange(SysLog(100, "old-1"), SysLog(120, "old-2"), SysLog(1, "fresh"));
        await _db.SaveChangesAsync();
        var freshId = _db.SystemLogs.Single(l => l.Message == "fresh").Id;

        var archive = await _log.ExportSystemLogsForArchive(DateTime.UtcNow.AddDays(-90), Path1("sys.csv"));

        Assert.Equal(2, archive.Count);
        Assert.NotNull(archive.MaxId);
        Assert.True(archive.MaxId < freshId);
        Assert.False(archive.Truncated);
        var csv = await File.ReadAllTextAsync(Path1("sys.csv"));
        Assert.Contains("old-1", csv);
        Assert.Contains("old-2", csv);
        Assert.DoesNotContain("fresh", csv);          // 未超期的行绝不进归档
    }

    [Fact]
    public async Task Cleanup_DeletesOnlyArchivedRows_AndLeavesOtherTableAlone()
    {
        _db.SystemLogs.AddRange(SysLog(100, "old-1"), SysLog(100, "old-2"), SysLog(1, "fresh"));
        _db.OperationLogs.AddRange(OpLog(400, "audit-old"), OpLog(1, "audit-fresh"));
        await _db.SaveChangesAsync();

        var sysArchive = await _log.ExportSystemLogsForArchive(DateTime.UtcNow.AddDays(-90), Path1("sys.csv"));
        // 操作日志本次未归档 → 传 null 不得删除（回归点：旧实现会把审计一起删掉）
        var result = await _log.CleanupOldLogs(sysArchive.MaxId, null);

        Assert.Equal(2, result.SystemDeleted);
        Assert.Equal(0, result.OperationDeleted);
        Assert.Equal("fresh", _db.SystemLogs.Single().Message);
        Assert.Equal(2, _db.OperationLogs.Count());
    }

    [Fact]
    public async Task Cleanup_WithNoArchive_DeletesNothing()
    {
        _db.SystemLogs.AddRange(SysLog(400, "old-1"), SysLog(400, "old-2"));
        await _db.SaveChangesAsync();

        var result = await _log.CleanupOldLogs(null, null);

        Assert.Equal(0, result.Total);
        Assert.Equal(2, _db.SystemLogs.Count());
    }

    [Fact]
    public async Task Cleanup_WhenArchiveTruncated_KeepsUnarchivedRemainder()
    {
        for (var i = 0; i < 5; i++) _db.SystemLogs.Add(SysLog(100, $"old-{i}"));
        await _db.SaveChangesAsync();

        var archive = await _log.ExportSystemLogsForArchive(DateTime.UtcNow.AddDays(-90), Path1("sys.csv"), limit: 2);
        Assert.Equal(2, archive.Count);
        Assert.True(archive.Truncated);              // 还有超期行没归档

        var result = await _log.CleanupOldLogs(archive.MaxId, null);

        Assert.Equal(2, result.SystemDeleted);
        Assert.Equal(3, _db.SystemLogs.Count());     // 未归档的 3 条必须保留（旧实现会被删光）
    }

    [Fact]
    public async Task Export_NoExpiredRows_WritesNoFileAndReportsNullMaxId()
    {
        _db.SystemLogs.Add(SysLog(1, "fresh"));
        await _db.SaveChangesAsync();

        var archive = await _log.ExportSystemLogsForArchive(DateTime.UtcNow.AddDays(-90), Path1("sys-empty.csv"));

        Assert.Equal(0, archive.Count);
        Assert.Null(archive.MaxId);
        Assert.False(File.Exists(Path1("sys-empty.csv")));
    }

    [Fact]
    public async Task Archiver_WithoutBaidu_StillWritesLocalFiles()
    {
        _db.SystemLogs.AddRange(SysLog(100, "old-sys"), SysLog(1, "fresh-sys"));
        _db.OperationLogs.AddRange(OpLog(400, "old-op"), OpLog(1, "fresh-op"));
        await _db.SaveChangesAsync();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Logs:ArchiveDir"] = _dir })
            .Build();
        var scopes = new TestScopeFactory(_db);
        var baidu = new BaiduNetdiskService(new HttpClient(), config, _log, _settings);
        var archiver = new LogArchiver(_log, baidu, _settings, config, NullLogger<LogArchiver>.Instance);

        var outcome = await archiver.ArchiveExpiredAsync();

        // 网盘未配置：仍然本地落盘，因此两条 MaxId 都有效 → 清理是安全的
        Assert.NotNull(outcome.System.MaxId);
        Assert.NotNull(outcome.Operation.MaxId);
        Assert.Null(outcome.SystemRemote);
        Assert.True(File.Exists(outcome.System.Path));
        Assert.True(File.Exists(outcome.Operation.Path));
        Assert.Contains("old-sys", await File.ReadAllTextAsync(outcome.System.Path));
        Assert.Contains("old-op", await File.ReadAllTextAsync(outcome.Operation.Path));

        var cleaned = await _log.CleanupOldLogs(outcome.System.MaxId, outcome.Operation.MaxId);
        Assert.Equal(1, cleaned.SystemDeleted);
        Assert.Equal(1, cleaned.OperationDeleted);
        Assert.Equal("fresh-sys", _db.SystemLogs.Single().Message);
        Assert.Equal("fresh-op", _db.OperationLogs.Single().Action);
    }
}
