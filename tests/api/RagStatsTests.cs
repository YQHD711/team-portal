using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P0-2 的读侧：日志行格式必须能被统计端解析（写读同源），
/// 空转率 = 近 7 天空结果次数 / 检索次数，最近 10 条空结果 query 按时间倒序。
/// </summary>
public class RagStatsTests : IDisposable
{
    private readonly AppDbContext _db;

    public RagStatsTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
    }

    public void Dispose() { _db.Dispose(); GC.SuppressFinalize(this); }

    private void Seed(string message, DateTime at, string category = RagLog.Category)
        => _db.SystemLogs.Add(new SystemLog { Category = category, Level = "info", Message = message, CreatedAt = at });

    [Fact]
    public void SearchLine_RoundTrips_AndTruncatesQueryTo40Chars()
    {
        var longQuery = new string('盘', 50);
        var line = RagLog.SearchLine(longQuery, hits: 7, returned: 3, empty: false);

        Assert.True(RagLog.TryParseSearch(line, out var q, out var hits, out var returned, out var empty));
        Assert.Equal(40, q.Length - 1);           // 40 字 + 省略号
        Assert.EndsWith("…", q);
        Assert.Equal(7, hits);
        Assert.Equal(3, returned);
        Assert.False(empty);
    }

    [Fact]
    public void SearchLine_SanitizesNewlines_AndCjkSpacesStillParse()
    {
        var line = RagLog.SearchLine("盘旋 半径\n由什么决定", hits: 0, returned: 0, empty: true);

        Assert.DoesNotContain('\n', line);
        Assert.True(RagLog.TryParseSearch(line, out var q, out _, out _, out var empty));
        Assert.Equal("盘旋 半径 由什么决定", q);
        Assert.True(empty);
    }

    [Fact]
    public void SearchLine_TrickyQueryContainingKeyword_StillParsesOurSuffix()
    {
        // query 里自带 " hits=99 returned=1 empty=False"：解析必须取行尾我们真正追加的那段
        var line = RagLog.SearchLine("foo hits=99 returned=1 empty=False", hits: 2, returned: 1, empty: false);

        Assert.True(RagLog.TryParseSearch(line, out var q, out var hits, out var returned, out var empty));
        Assert.Equal("foo hits=99 returned=1 empty=False", q);
        Assert.Equal(2, hits);
        Assert.Equal(1, returned);
        Assert.False(empty);
    }

    [Fact]
    public void ContextLine_RoundTrips() 
    {
        Assert.True(RagLog.TryParseContext(RagLog.ContextLine(1234, 3), out var chars, out var used));
        Assert.Equal(1234, chars);
        Assert.Equal(3, used);
        Assert.False(RagLog.TryParseContext("RAG search: q=x hits=1 returned=1 empty=False", out _, out _));
    }

    [Fact]
    public async Task Stats_ComputesEmptyRate_AndAverages_IgnoringOtherCategoriesAndOldRows()
    {
        var now = DateTime.UtcNow;
        Seed(RagLog.SearchLine("盘旋半径由什么决定", 5, 2, empty: false), now.AddHours(-1));
        Seed(RagLog.SearchLine("工程部怎么学", 0, 0, empty: true), now.AddHours(-2));
        Seed(RagLog.SearchLine("电子部资料", 0, 0, empty: true), now.AddHours(-3));
        Seed(RagLog.SearchLine("旧问题", 0, 0, empty: true), now.AddDays(-8));           // 窗口外
        Seed("RAG search: 这行格式不对", now.AddHours(-1));                              // 解析不了 → 不计
        Seed(RagLog.SearchLine("别的类别", 0, 0, empty: true), now.AddHours(-1), "wiki"); // 类别不对 → 不计
        Seed(RagLog.ContextLine(600, 2), now.AddHours(-1));
        Seed(RagLog.ContextLine(1000, 4), now.AddHours(-2));
        await _db.SaveChangesAsync();

        var stats = await new RagStatsService(_db).GetAsync(now);

        Assert.Equal(RagStatsService.WindowDays, stats.Days);
        Assert.Equal(3, stats.SearchCount);
        Assert.Equal(2, stats.EmptyCount);
        Assert.Equal(66.7, stats.EmptyRatePct);
        Assert.Equal(2, stats.ReturnedTotal);
        Assert.Equal(2, stats.ContextCount);
        Assert.Equal(800, stats.AvgContextChars);
        Assert.Equal(3, stats.AvgUsedDocs);
        Assert.Equal(["工程部怎么学", "电子部资料"], stats.RecentEmpty.Select(e => e.Query));
    }

    [Fact]
    public async Task Stats_RecentEmpty_IsLastTen_NewestFirst()
    {
        var now = DateTime.UtcNow;
        for (var i = 0; i < 12; i++)
            Seed(RagLog.SearchLine($"空问题{i}", 0, 0, empty: true), now.AddMinutes(-i));
        await _db.SaveChangesAsync();

        var stats = await new RagStatsService(_db).GetAsync(now);

        Assert.Equal(12, stats.SearchCount);
        Assert.Equal(12, stats.EmptyCount);
        Assert.Equal(100, stats.EmptyRatePct);
        Assert.Equal(RagStatsService.MaxRecentEmpty, stats.RecentEmpty.Count);
        Assert.Equal("空问题0", stats.RecentEmpty[0].Query);     // 最新在前
        Assert.Equal("空问题9", stats.RecentEmpty[9].Query);
    }

    [Fact]
    public async Task Stats_NoData_ReturnsZeros()
    {
        var stats = await new RagStatsService(_db).GetAsync(DateTime.UtcNow);

        Assert.Equal(0, stats.SearchCount);
        Assert.Equal(0, stats.EmptyCount);
        Assert.Equal(0, stats.EmptyRatePct);
        Assert.Empty(stats.RecentEmpty);
        Assert.Equal(0, stats.AvgUsedDocs);
    }
}
