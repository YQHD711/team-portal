using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 物料等级可见性：GetAll 传 grades 时只返回这些等级。
///
/// 语义与权限矩阵配合：
/// - grades = null：内部/管理场景，不过滤；
/// - 空集合：有「查看库存」但没有任意等级权限 → 什么都看不到；
/// - 具体集合：只返回这些等级（A 关键件 / B 常规件 / C 耗材）。
/// </summary>
public class InventoryGradeScopeTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly InventoryService _svc;

    public InventoryGradeScopeTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
        // GetAll 只用到 DbContext；日志/通知/设置在列表查询里不参与，测试里不构造。
        _svc = new InventoryService(_db, null!, null!, null!);
    }

    private async Task SeedAsync()
    {
        _db.InventoryItems.AddRange(
            new InventoryItem { Name = "飞控板", Category = "飞控系统", Quantity = 1, Grade = "A", UnitPrice = 1200 },
            new InventoryItem { Name = "电机", Category = "动力系统", Quantity = 2, Grade = "B", UnitPrice = 300 },
            new InventoryItem { Name = "M3 螺丝", Category = "耗材", Quantity = 9, Grade = "C", UnitPrice = 1 });
        await _db.SaveChangesAsync();
    }

    [Fact]
    public async Task NullGrades_ReturnsAll()
    {
        await SeedAsync();
        var items = await _svc.GetAll(null, null);
        Assert.Equal(3, items.Count);
    }

    [Fact]
    public async Task OnlyAllowedGrades_AreReturned()
    {
        await SeedAsync();

        var member = await _svc.GetAll(null, null, new[] { "C" });
        Assert.Equal("M3 螺丝", Assert.Single(member).Name);

        var lead = await _svc.GetAll(null, null, new[] { "B", "C" });
        Assert.Equal(2, lead.Count);
        Assert.DoesNotContain(lead, i => i.Grade == "A");
    }

    [Fact]
    public async Task EmptyGrades_ReturnsNothing()
    {
        await SeedAsync();
        Assert.Empty(await _svc.GetAll(null, null, Array.Empty<string>()));
    }

    [Fact]
    public async Task GradeFilter_CombinesWithSearch()
    {
        await SeedAsync();
        // 关键字命中 A 级，但用户只有 C 级权限 → 搜不出来
        Assert.Empty(await _svc.GetAll("飞控", null, new[] { "C" }));
        Assert.Single(await _svc.GetAll("飞控", null, new[] { "A" }));
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }
}
