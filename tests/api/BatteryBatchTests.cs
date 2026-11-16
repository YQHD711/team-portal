using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>批量录电池：连续编码、同型号、数量校验。</summary>
public class BatteryBatchTests
{
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        return ctx;
    }

    private static BatteryService Svc(AppDbContext db)
        => new(db, new NullLogService(new TestScopeFactory(db)), new SettingsService(new TestScopeFactory(db)));

    [Fact]
    public async Task Batch_CreatesContinuousCodes()
    {
        var db = CreateContext();
        var svc = Svc(db);
        var created = await svc.CreateBatchAsync(5, "6S 3300mAh", "正常", "批量测试");
        Assert.Equal(5, created.Count);
        Assert.Equal("BAT-0001", created[0].Code);
        Assert.Equal("BAT-0005", created[4].Code);
        Assert.All(created, b => Assert.Equal("6S 3300mAh", b.Model));
    }

    [Fact]
    public async Task Batch_RejectsInvalidCount()
    {
        var db = CreateContext();
        var svc = Svc(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateBatchAsync(0, "x", null, null));
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateBatchAsync(501, "x", null, null));
    }

    [Fact]
    public async Task Batch_ContinuesFromExistingCodes()
    {
        var db = CreateContext();
        var svc = Svc(db);
        await svc.CreateAsync("BAT-0010", "x", null, null);
        var created = await svc.CreateBatchAsync(2, "y", null, null);
        Assert.Equal("BAT-0011", created[0].Code);
        Assert.Equal("BAT-0012", created[1].Code);
    }
}
