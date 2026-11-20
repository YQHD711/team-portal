using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 内容管理的存储约束：引导进度一人一条、删用户级联清进度、
/// 文案覆盖删除即恢复默认、引导 StepsJson 原样往返。
/// </summary>
public class ContentStorageTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public ContentStorageTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
    }

    private async Task<int> SeedUserAsync()
    {
        var u = new User { Username = "member1", PasswordHash = "x", Role = "member" };
        _db.Users.Add(u);
        await _db.SaveChangesAsync();
        return u.Id;
    }

    [Fact]
    public async Task TourProgress_IsUniquePerUserAndTour()
    {
        var uid = await SeedUserAsync();
        _db.UserTourProgresses.Add(new UserTourProgress { UserId = uid, TourKey = "welcome", Status = "done" });
        await _db.SaveChangesAsync();

        _db.UserTourProgresses.Add(new UserTourProgress { UserId = uid, TourKey = "welcome", Status = "skipped" });
        await Assert.ThrowsAsync<DbUpdateException>(() => _db.SaveChangesAsync());
    }

    [Fact]
    public async Task TourProgress_IsDeletedWithUser()
    {
        var uid = await SeedUserAsync();
        _db.UserTourProgresses.Add(new UserTourProgress { UserId = uid, TourKey = "battery", Status = "done" });
        await _db.SaveChangesAsync();

        var user = await _db.Users.FindAsync(uid);
        _db.Users.Remove(user!);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Empty(await _db.UserTourProgresses.Where(p => p.UserId == uid).ToListAsync());
    }

    [Fact]
    public async Task SiteText_RemovingOverrideRestoresDefaultSemantics()
    {
        _db.SiteTexts.Add(new SiteText { Key = "nav.inventory", Value = "零件仓库", Group = "导航" });
        await _db.SaveChangesAsync();
        Assert.Equal("零件仓库", (await _db.SiteTexts.FindAsync("nav.inventory"))!.Value);

        // 「恢复默认」= 删除覆盖行；表里没有的 key 由前端回落到代码默认值
        var row = await _db.SiteTexts.FindAsync("nav.inventory");
        _db.SiteTexts.Remove(row!);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Empty(await _db.SiteTexts.ToListAsync());
    }

    [Fact]
    public async Task GuideContent_RoundTripsStepsJson()
    {
        const string steps = """[{"id":"scan","target":"battery-scan","title":"扫码","body":"扫电池上的码"}]""";
        _db.GuideContents.Add(new GuideContent { TourKey = "battery", Title = "电池借还（改）", StepsJson = steps, Version = 2 });
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var saved = await _db.GuideContents.FindAsync("battery");
        Assert.NotNull(saved);
        Assert.Equal(steps, saved!.StepsJson);
        Assert.Equal(2, saved.Version);
        Assert.True(saved.Enabled);
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }
}
