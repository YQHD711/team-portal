using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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

    /// <summary>
    /// 通知测试专用：文件库 + 「每个 scope 新建 DbContext」的作用域工厂。
    ///
    /// 通知是 NotificationService 的后台 channel 消费者异步落库的。若它和测试线程共用
    /// 同一个 DbContext 实例，轮询与写入就会撞上
    /// "A second operation was started on this context instance before a previous operation
    /// completed" —— CI 上随机红，而且会连带把 main 的 build-push 跳过（部署被卡住）。
    /// 所以：库用文件（两条连接看到同一份数据），消费者每次 scope 自己新建上下文。
    /// </summary>
    private static (AppDbContext Db, DbContextOptions<AppDbContext> Opts, string Path) CreateFileDb()
    {
        var path = Path.Combine(Path.GetTempPath(), $"tp-lowstock-{Guid.NewGuid():N}.db");
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={path}").Options;
        var db = new AppDbContext(opts);
        db.Database.EnsureCreated();
        return (db, opts, path);
    }

    private static void CleanupFileDb(string path)
    {
        try { File.Delete(path); } catch { /* 尽力而为 */ }
    }

    /// <summary>每个 scope 给一个独立的 AppDbContext（同一个文件库）。</summary>
    private sealed class FreshContextScopeFactory : IServiceScopeFactory
    {
        private readonly DbContextOptions<AppDbContext> _opts;
        public FreshContextScopeFactory(DbContextOptions<AppDbContext> opts) => _opts = opts;

        public IServiceScope CreateScope()
        {
            var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection();
            services.AddScoped(_ => new AppDbContext(_opts));
            return services.BuildServiceProvider().CreateScope();
        }
    }

    private static InventoryService CreateService(AppDbContext db)
    {
        var scopes = new TestScopeFactory(db);
        return new InventoryService(db, new NullLogService(scopes), new NotificationService(scopes, new NullLogService(scopes)),
            new SettingsService(scopes));
    }

    /// <param name="opts">用于让通知的后台消费者每次新建上下文，避免与测试线程抢同一个实例</param>
    private static InventoryService CreateService(AppDbContext db, DbContextOptions<AppDbContext> opts)
    {
        var scopes = new FreshContextScopeFactory(opts);
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
        var (db, opts, path) = CreateFileDb();
        try
        {
            var svc = CreateService(db, opts);

            // 阈值 10：库存 4 应触发预警
            await new SettingsService(new TestScopeFactory(db)).Set("Inventory:LowStockThreshold", "10");
            await svc.Create("低库存件", "耗材", 4, "C", 1m, null, null, null);
            Assert.True(await WaitForNotificationAsync(db, "低库存件"), "阈值 10 时库存 4 应产生预警通知");
        }
        finally { CleanupFileDb(path); }

        // 阈值 3：库存 4 不该触发
        var (db2, opts2, path2) = CreateFileDb();
        try
        {
            await new SettingsService(new TestScopeFactory(db2)).Set("Inventory:LowStockThreshold", "3");
            await CreateService(db2, opts2).Create("充足件", "耗材", 4, "C", 1m, null, null, null);
            Assert.False(await WaitForNotificationAsync(db2, "充足件", TimeSpan.FromSeconds(2)), "阈值 3 时库存 4 不应产生通知");
        }
        finally { CleanupFileDb(path2); }
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
