using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 低库存阈值单一来源：设置页的 Inventory:LowStockThreshold 同时驱动仪表盘、库存页(meta 接口)
/// 与库存预警通知，比较符统一为「数量 &lt; 阈值」。
/// 回归的原始缺陷：阈值被硬编码成 4 份（设置 5 / InventoryService 常量 3 / 前端常量 3 /
/// 仪表盘页面 3 且用 &lt;=），改设置只影响仪表盘列表。
/// </summary>
public class LowStockThresholdTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public LowStockThresholdTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private static AppDbContext CreateDb()
    {
        var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static InventoryService CreateService(AppDbContext db)
    {
        var scopes = new TestScopeFactory(db);
        return new InventoryService(db, new NullLogService(scopes), new NotificationService(scopes, new NullLogService(scopes)),
            new SettingsService(scopes));
    }

    [Fact]
    public async Task Threshold_ComesFromSettings_WithSeededDefault()
    {
        var db = CreateDb();
        var svc = CreateService(db);

        Assert.Equal(5, await svc.GetLowStockThresholdAsync());   // 未配置时用 InventoryService.DefaultLowStockThreshold

        await new SettingsService(new TestScopeFactory(db)).Set("Inventory:LowStockThreshold", "10");
        Assert.Equal(10, await CreateService(db).GetLowStockThresholdAsync());
    }

    [Theory]
    [InlineData(0, 5, true)]
    [InlineData(4, 5, true)]
    [InlineData(5, 5, false)]      // 严格小于：等于阈值不算低（旧的 <= 口径会误报）
    [InlineData(6, 5, false)]
    public void IsLowStock_UsesStrictlyLessThan(int qty, int threshold, bool expected)
    {
        Assert.Equal(expected, InventoryService.IsLowStock(qty, threshold));
    }

    [Fact]
    public async Task Notification_FollowsConfiguredThreshold()
    {
        var db = CreateDb();
        var settings = new SettingsService(new TestScopeFactory(db));
        var svc = CreateService(db);

        // 阈值 10：库存 4 应触发预警
        await settings.Set("Inventory:LowStockThreshold", "10");
        await svc.Create("低库存件", "耗材", 4, "C", 1m, null, null, null);
        Assert.True(await WaitForNotificationAsync(db, "低库存件"), "阈值 10 时库存 4 应产生预警通知");

        // 阈值 3：库存 4 不该触发
        var db2 = CreateDb();
        await new SettingsService(new TestScopeFactory(db2)).Set("Inventory:LowStockThreshold", "3");
        await CreateService(db2).Create("充足件", "耗材", 4, "C", 1m, null, null, null);
        Assert.False(await WaitForNotificationAsync(db2, "充足件", TimeSpan.FromSeconds(2)), "阈值 3 时库存 4 不应产生通知");
    }

    /// <summary>通知经 channel 异步落库，轮询等待（与 NotificationServiceTests 的等待方式一致）</summary>
    private static async Task<bool> WaitForNotificationAsync(AppDbContext db, string keyword, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(5));
        while (DateTime.UtcNow < deadline)
        {
            var found = await db.Notifications.AsNoTracking().AnyAsync(n => n.Message.Contains(keyword));
            if (found) return true;
            await Task.Delay(50);
        }
        return await db.Notifications.AsNoTracking().AnyAsync(n => n.Message.Contains(keyword));
    }

    [Fact]
    public async Task MetaEndpoint_ExistsAndIsProtected()
    {
        // 前端依赖该接口下发阈值：未登录必须 401（缺路由会是 404，等于前端静默回到硬编码）
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-lowstock-{Guid.NewGuid():N}.db");
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        try
        {
            var res = await client.GetAsync("/api/inventory/meta");
            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }
}
