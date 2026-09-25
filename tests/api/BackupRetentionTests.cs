using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 备份保留策略与每日任务判重。
///
/// 线上巡检发现磁盘用到 85%（41.88GB 里只剩 6.23GB），其中 backups/db 有 177 份备份约 1.8GB。
/// 两个原因，各有一个测试盯着：
/// 1) 轮转只清理 *_auto.db，*_daily.db 从来不清 → 每日备份无限增长；
/// 2) 每日任务的判据是「距上次运行满 23 小时」，而容器每次部署都会重启、计时归零
///    → 每次重启都再生成一份每日备份。
/// </summary>
public class BackupRetentionTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "tp-retention-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public BackupRetentionTests()
    {
        Directory.CreateDirectory(_dir);
        // LogService 的后台消费者会用到 DbContext，给个真的内存库，别让它抛
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
        try { Directory.Delete(_dir, true); } catch { /* 尽力而为 */ }
    }

    /// <summary>造 n 份形如 20260901-120000_tag.db 的假备份（前缀是北京时间戳，按天递增）。</summary>
    private List<string> Seed(string tag, int count, int startDay = 1)
    {
        var paths = new List<string>();
        for (var i = 0; i < count; i++)
        {
            var day = (startDay + i) % 28 + 1;
            var month = 9 + (startDay + i) / 28;
            var path = Path.Combine(_dir, $"2026{month:00}{day:00}-120000_{tag}.db");
            File.WriteAllText(path, "x");
            paths.Add(path);
        }
        return paths;
    }

    // ── 保留数量 ──────────────────────────────────────────

    [Fact]
    public void DailyBackups_ArePrunedToTheKeepLimit()
    {
        Seed("daily", 30);

        var stale = BackupService.SelectStaleBackups(_dir, "daily", 14);

        // 30 份里保留最新 14 份，另外 16 份淘汰 —— daily 此前一份都不淘汰
        Assert.Equal(16, stale.Count);
        Assert.All(stale, f => Assert.True(File.Exists(f)));
    }

    [Fact]
    public void AutoBackups_ArePrunedToTheKeepLimit()
    {
        Seed("auto", 30);
        Assert.Equal(6, BackupService.SelectStaleBackups(_dir, "auto", 24).Count);
    }

    [Fact]
    public void UnderTheLimit_NothingIsPruned()
    {
        Seed("daily", 3);
        Assert.Empty(BackupService.SelectStaleBackups(_dir, "daily", 14));
    }

    [Fact]
    public void PruningOneTag_LeavesTheOthersAlone()
    {
        Seed("daily", 20);
        Seed("auto", 20);

        var stale = BackupService.SelectStaleBackups(_dir, "daily", 14);

        Assert.Equal(6, stale.Count);
        Assert.All(stale, f => Assert.EndsWith("_daily.db", f));
        // 手动备份(manual)永不自动清理：这里根本没有 manual 被选中
        Assert.DoesNotContain(BackupService.SelectStaleBackups(_dir, "manual", 14), f => f.Contains("_auto.db"));
    }

    [Fact]
    public void MissingDirectory_IsNotAnError()
    {
        Assert.Empty(BackupService.SelectStaleBackups(Path.Combine(_dir, "nope"), "daily", 14));
        Assert.Null(BackupService.LatestBackupDateIn(Path.Combine(_dir, "nope"), "daily"));
    }

    // ── 接线：RotateBackups 到底清了哪些 tag ────────────────

    private BackupService NewService()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={Path.Combine(_dir, "teamportal.db")}"
            }).Build();
        var log = new NullLogService(new TestScopeFactory(_db));
        return new BackupService(config, new StubEnv { ContentRootPath = _dir }, log);
    }

    private string BackupDir()
    {
        var dir = Path.Combine(_dir, "backups", "db");
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>
    /// 这条盯的是接线本身：SelectStaleBackups 测对了、但 RotateBackups 忘了对 daily 调用，
    /// 线上照样会无限增长 —— 所以必须从 RotateBackups 进来断言最终目录状态。
    /// </summary>
    [Fact]
    public void RotateBackups_BoundsDailyAutoAndLeavesManualAlone()
    {
        var svc = NewService();
        var dir = BackupDir();
        foreach (var tag in new[] { "daily", "auto", "manual" })
            for (var i = 0; i < 30; i++)
                File.WriteAllText(Path.Combine(dir, $"2026{9 + i / 28:00}{i % 28 + 1:00}-120000_{tag}.db"), "x");

        svc.RotateBackups();

        Assert.Equal(14, Directory.GetFiles(dir, "*_daily.db").Length);
        Assert.Equal(24, Directory.GetFiles(dir, "*_auto.db").Length);
        Assert.Equal(30, Directory.GetFiles(dir, "*_manual.db").Length);   // 手动备份一份都不许动
    }

    [Fact]
    public void RotateBackups_RemovesOrphanedSidecars()
    {
        var svc = NewService();
        var dir = BackupDir();
        var kept = Path.Combine(dir, "20260925-120000_daily.db");
        File.WriteAllText(kept, "x");
        File.WriteAllText(kept + "-wal", "");
        File.WriteAllText(kept + "-shm", "");
        var orphan = Path.Combine(dir, "20260901-120000_daily.db-shm"); // 对应的 .db 早被删了
        File.WriteAllText(orphan, "");

        svc.RotateBackups();

        Assert.True(File.Exists(kept + "-shm"));      // 备份还在，边车不动
        Assert.False(File.Exists(orphan));            // 孤儿边车清掉
    }

    private sealed class StubEnv : Microsoft.AspNetCore.Hosting.IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Test";
        public string WebRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    // ── 每日任务判重 ──────────────────────────────────────

    [Fact]
    public void LatestBackupDate_UsesTheFilenamePrefix()
    {
        Seed("daily", 5);

        var date = BackupService.LatestBackupDateIn(_dir, "daily");

        Assert.NotNull(date);
        Assert.Equal(8, date!.Length);
        Assert.All(date, c => Assert.True(char.IsAsciiDigit(c)));
    }

    [Fact]
    public void LatestBackupDate_IgnoresUnparsableNames()
    {
        File.WriteAllText(Path.Combine(_dir, "garbage_daily.db"), "x");
        Assert.Null(BackupService.LatestBackupDateIn(_dir, "daily"));

        File.WriteAllText(Path.Combine(_dir, "20260925-101010_daily.db"), "x");
        Assert.Equal("20260925", BackupService.LatestBackupDateIn(_dir, "daily"));
    }

    /// <summary>回归：容器每次部署都会重启，重启不能再触发一次每日任务。</summary>
    [Fact]
    public void DailyJob_DoesNotRerunAfterRestartOnTheSameDay()
    {
        // 北京时间 15:00 = UTC 07:00；当天已经备份过
        var utcAfternoon = new DateTime(2026, 9, 25, 7, 0, 0, DateTimeKind.Utc);
        Assert.False(MaintenanceWorker.ShouldRunDaily(utcAfternoon, "20260925"));
    }

    [Fact]
    public void DailyJob_RunsOncePerDay()
    {
        var utcAfternoon = new DateTime(2026, 9, 25, 7, 0, 0, DateTimeKind.Utc);

        // 昨天做过 → 今天该做
        Assert.True(MaintenanceWorker.ShouldRunDaily(utcAfternoon, "20260924"));
        // 从没做过(新装) → 该做
        Assert.True(MaintenanceWorker.ShouldRunDaily(utcAfternoon, null));
    }

    [Theory]
    // 北京时间 02:59 = UTC 前一天 18:59 → 还没到 3 点，不跑
    [InlineData(2026, 9, 24, 18, 59, false)]
    // 北京时间 03:00 = UTC 19:00 → 到点了
    [InlineData(2026, 9, 24, 19, 0, true)]
    [InlineData(2026, 9, 24, 19, 1, true)]
    public void DailyJob_OnlyRunsAfter3AmBeijing(int y, int m, int d, int h, int min, bool expected)
    {
        var utc = new DateTime(y, m, d, h, min, 0, DateTimeKind.Utc);
        Assert.Equal(expected, MaintenanceWorker.ShouldRunDaily(utc, null));
    }

    /// <summary>北京时间跨日那一刻(UTC 16:00)应算作新的一天。</summary>
    [Fact]
    public void DailyJob_UsesBeijingDateNotUtcDate()
    {
        // UTC 2026-09-24 16:30 = 北京时间 2026-09-25 00:30 → 新的一天，但还没到 3 点
        var utc = new DateTime(2026, 9, 24, 16, 30, 0, DateTimeKind.Utc);
        Assert.False(MaintenanceWorker.ShouldRunDaily(utc, "20260924"));

        // 同一天北京时间 03:30，已经备份过 20260925 → 不重复
        var utcLater = new DateTime(2026, 9, 24, 19, 30, 0, DateTimeKind.Utc);
        Assert.False(MaintenanceWorker.ShouldRunDaily(utcLater, "20260925"));
        Assert.True(MaintenanceWorker.ShouldRunDaily(utcLater, "20260924"));
    }
}
