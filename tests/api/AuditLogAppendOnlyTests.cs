using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// FIX-03 / H-04：审计日志 append-only 加固。
/// 核心不变量：**没有归档覆盖的行，任何路径都不得删除**（LazyPrune / 强制清空都一样）。
/// 另：清理回执 {count, table, maxId, sha256} 必须持久化到 SystemSettings（不随日志清理删除）。
/// </summary>
public class AuditLogAppendOnlyTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly SettingsService _settings;
    private readonly LogService _log;
    private readonly string _dir;

    public AuditLogAppendOnlyTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        var scopes = new TestScopeFactory(_db);
        _settings = new SettingsService(scopes);
        _log = new LogService(scopes, NullLogger<LogService>.Instance, _settings);
        _dir = Path.Combine(Path.GetTempPath(), $"tp-appendonly-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        _log.Dispose();
        try { Directory.Delete(_dir, true); } catch { /* best effort */ }
        GC.SuppressFinalize(this);
    }

    private static OperationLog OldOp(int daysAgo, string action) => new()
    {
        UserName = "tester", Action = action, TargetType = "inventory", TargetId = "1",
        CreatedAt = DateTime.UtcNow.AddDays(-daysAgo),
    };

    private static SystemLog OldSys(int daysAgo, string message) => new()
    {
        Level = "info", Category = "http", Message = message,
        CreatedAt = DateTime.UtcNow.AddDays(-daysAgo),
    };

    private LogService NewLogService()
    {
        var scopes = new TestScopeFactory(_db);
        return new LogService(scopes, NullLogger<LogService>.Instance, _settings);
    }

    private string Path1(string name) => Path.Combine(_dir, name);

    [Fact]
    public async Task LazyPrune_WithoutAnyArchive_DeletesNothing()
    {
        _db.OperationLogs.AddRange(OldOp(400, "old-1"), OldOp(500, "old-2"));
        await _db.SaveChangesAsync();

        Assert.Equal(0, await _log.LazyPruneOperationLogs());
        Assert.Equal(2, await _db.OperationLogs.AsNoTracking().CountAsync());
    }

    [Fact]
    public async Task LazyPrune_AfterArchivedCleanup_DeletesOnlyRowsCoveredByWatermark()
    {
        _db.OperationLogs.AddRange(OldOp(400, "old-1"), OldOp(400, "old-2"), OldOp(1, "fresh"));
        await _db.SaveChangesAsync();

        var archive = await _log.ExportOperationsForArchive(DateTime.UtcNow.AddDays(-180), Path1("op.csv"));
        Assert.NotNull(archive.MaxId);

        var cleaned = await _log.CleanupOldLogs(null, archive.MaxId);
        Assert.Equal(2, cleaned.OperationDeleted);
        Assert.Equal(1, await _db.OperationLogs.AsNoTracking().CountAsync());
        Assert.Equal(archive.MaxId, await _log.GetArchiveWatermarkAsync(LogService.OperationArchiveWatermarkKey));

        // 再插一条超期但**未归档**的行：Id 高于水位 → 惰性清理不得碰它
        _db.OperationLogs.Add(OldOp(400, "old-unarchived"));
        await _db.SaveChangesAsync();
        var unarchivedId = await _db.OperationLogs.AsNoTracking().MaxAsync(o => o.Id);
        Assert.True(unarchivedId > archive.MaxId!.Value);

        using var pruner = NewLogService();
        Assert.Equal(0, await pruner.LazyPruneOperationLogs());
        // 剩余两条：未超期的 "fresh" + 刚插入的"超期但未归档"行 —— 后者必须保留
        Assert.Equal(2, await _db.OperationLogs.AsNoTracking().CountAsync());
        Assert.True(await _db.OperationLogs.AsNoTracking().AnyAsync(o => o.Action == "old-unarchived"));
    }

    [Fact]
    public async Task ClearArchivedLogs_WithoutArchive_DeletesNothing()
    {
        _db.SystemLogs.AddRange(OldSys(400, "old"), OldSys(1, "fresh"));
        _db.OperationLogs.AddRange(OldOp(400, "old-op"));
        await _db.SaveChangesAsync();

        var result = await _log.ClearArchivedLogs(null, null);

        Assert.Equal(0, result.Total);
        Assert.Equal(2, await _db.SystemLogs.AsNoTracking().CountAsync());
        Assert.Equal(1, await _db.OperationLogs.AsNoTracking().CountAsync());
    }

    [Fact]
    public async Task ClearArchivedLogs_AfterArchiveAll_RemovesOnlyArchivedRows()
    {
        _db.SystemLogs.AddRange(OldSys(400, "old"), OldSys(1, "fresh"));
        _db.OperationLogs.AddRange(OldOp(400, "old-op"), OldOp(1, "fresh-op"));
        await _db.SaveChangesAsync();

        // 强制清理会先做全量归档（cutoff = now+1s），随后按归档 MaxId 删除
        var sys = await _log.ExportSystemLogsForArchive(DateTime.UtcNow.AddSeconds(1), Path1("sys-all.csv"));
        var op = await _log.ExportOperationsForArchive(DateTime.UtcNow.AddSeconds(1), Path1("op-all.csv"));

        var result = await _log.ClearArchivedLogs(sys.MaxId, op.MaxId);

        Assert.Equal(4, result.Total);
        Assert.Empty(await _db.SystemLogs.AsNoTracking().ToListAsync());
        Assert.Empty(await _db.OperationLogs.AsNoTracking().ToListAsync());
        Assert.Equal(sys.MaxId, await _log.GetArchiveWatermarkAsync(LogService.SystemArchiveWatermarkKey));
        Assert.Equal(op.MaxId, await _log.GetArchiveWatermarkAsync(LogService.OperationArchiveWatermarkKey));
    }

    [Fact]
    public async Task RecordCleanup_WritesPersistentReceiptWithCountTableMaxIdAndSha256()
    {
        _db.SystemLogs.AddRange(OldSys(400, "old-1"), OldSys(400, "old-2"));
        await _db.SaveChangesAsync();

        var archive = await _log.ExportSystemLogsForArchive(DateTime.UtcNow.AddDays(-90), Path1("sys.csv"));
        var deleted = await _log.CleanupOldLogs(archive.MaxId, null);
        await _log.RecordCleanupAsync(new[]
        {
            new LogCleanupEntry("SystemLogs", archive.Count, archive.MaxId,
                LogService.Sha256OfFile(archive.Path), archive.Path, null, deleted.SystemDeleted),
        }, "tester", forced: false);

        var raw = await _settings.Get(LogService.LastCleanupSettingKey, "");
        Assert.False(string.IsNullOrWhiteSpace(raw));
        using var doc = JsonDocument.Parse(raw);
        var entry = doc.RootElement.GetProperty("entries")[0];
        Assert.Equal("SystemLogs", entry.GetProperty("table").GetString());
        Assert.Equal(2, entry.GetProperty("count").GetInt32());
        Assert.Equal(archive.MaxId!.Value, entry.GetProperty("maxId").GetInt64());
        Assert.Equal(64, entry.GetProperty("sha256").GetString()!.Length);
        Assert.Equal("tester", doc.RootElement.GetProperty("actor").GetString());
    }
}