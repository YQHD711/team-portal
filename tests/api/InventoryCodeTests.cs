using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 物料编码：可自动生成、也可手填（《物料管理规范》§6.2 五段式）。
/// 同时覆盖"库位编码可以留空"（含编辑时清空）。
/// </summary>
public class InventoryCodeTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly InventoryService _svc;

    public InventoryCodeTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
        var scopes = new TestScopeFactory(_db);
        var log = new NullLogService(scopes);
        _svc = new InventoryService(_db, log, new NotificationService(scopes, log), new SettingsService(scopes));
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }

    // ── 分类前缀（与规范附录 A/D 对齐）──

    [Theory]
    [InlineData("电子元器件", "EL")]
    [InlineData("结构材料", "ST")]
    [InlineData("工具设备", "TL")]
    [InlineData("耗材", "CS")]
    [InlineData("动力系统", "PW")]
    [InlineData("飞控系统", "FC")]
    [InlineData("通信设备", "RF")]
    [InlineData("电池电源", "BAT")]
    [InlineData("其他", "XX")]
    [InlineData("不认识的分类", "XX")]
    [InlineData(null, "XX")]
    public void CategoryPrefix_MatchesSpec(string? category, string expected)
        => Assert.Equal(expected, InventoryService.CategoryPrefix(category));

    // ── 自动生号 ──

    [Fact]
    public async Task NextCode_FirstIs0001_AndIncrementsPerPool()
    {
        var first = await _svc.NextCodeAsync("电池电源", "LIPO", "6S3300MAH", 2026);
        Assert.Equal("BAT-LIPO-6S3300MAH-2026-0001", first);

        await _svc.Create("3S 3300 电池", "电池电源", 5, code: first);
        var second = await _svc.NextCodeAsync("电池电源", "LIPO", "6S3300MAH", 2026);
        Assert.Equal("BAT-LIPO-6S3300MAH-2026-0002", second);
    }

    [Fact]
    public async Task NextCode_DifferentPoolsAreIndependent()
    {
        // 序号按「前缀-物品号-型号-年份」各自从 0001 起
        await _svc.Create("锂聚合物电池", "电池电源", 5, code: "BAT-LIPO-6S3300MAH-2026-0001");

        var other = await _svc.NextCodeAsync("电池电源", "NIMH", "4S2000MAH", 2026);

        Assert.Equal("BAT-NIMH-4S2000MAH-2026-0001", other);
    }

    [Fact]
    public async Task NextCode_NormalizesInputToUpperCase()
    {
        var code = await _svc.NextCodeAsync("电池电源", "lipo", "6s3300mah", 2026);
        Assert.Equal("BAT-LIPO-6S3300MAH-2026-0001", code);
    }

    [Fact]
    public async Task NextCode_PicksMaxPlusOneEvenWithGaps()
    {
        await _svc.Create("a", "耗材", 1, code: "CS-SCREW-M3-2026-0001");
        await _svc.Create("b", "耗材", 1, code: "CS-SCREW-M3-2026-0007");

        // 取最大值 +1，避免和已存在的 0007 撞车（不是取 count+1）
        var next = await _svc.NextCodeAsync("耗材", "SCREW", "M3", 2026);

        Assert.Equal("CS-SCREW-M3-2026-0008", next);
    }

    // ── 手填编码：规范化与查重 ──

    [Fact]
    public async Task Create_LowercaseCode_StoredUppercase()
    {
        var item = await _svc.Create("电池", "电池电源", 1, code: "  bat-lipo-6s3300mah-2026-0001  ");

        Assert.Equal("BAT-LIPO-6S3300MAH-2026-0001", item.Code);
    }

    [Fact]
    public async Task Create_EmptyCode_StaysNull()
    {
        // 允许留空：新到的物料还没贴标
        var item = await _svc.Create("还没编号的件", "其他", 1, code: "   ");

        Assert.Null(item.Code);
    }

    [Fact]
    public async Task Create_DuplicateCode_Throws()
    {
        await _svc.Create("电池A", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0001");

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => _svc.Create("电池B", "电池电源", 1, code: "bat-lipo-6s3300mah-2026-0001"));

        Assert.Contains("已被占用", ex.Message);
    }

    [Fact]
    public async Task Update_KeepingOwnCode_IsAllowed()
    {
        var item = await _svc.Create("电池", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0001");

        // 改别的字段、编码原样传回来 → 不能因为"和自己重复"而报错
        var updated = await _svc.Update(item.Id, quantity: 9, code: "BAT-LIPO-6S3300MAH-2026-0001");

        Assert.Equal(9, updated!.Quantity);
        Assert.Equal("BAT-LIPO-6S3300MAH-2026-0001", updated.Code);
    }

    [Fact]
    public async Task Update_TakingAnotherItemsCode_Throws()
    {
        await _svc.Create("电池A", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0001");
        var b = await _svc.Create("电池B", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0002");

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _svc.Update(b.Id, code: "BAT-LIPO-6S3300MAH-2026-0001"));
    }

    [Fact]
    public async Task Update_ClearCode_RemovesIt()
    {
        var item = await _svc.Create("电池", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0001");

        var updated = await _svc.Update(item.Id, clearCode: true);

        Assert.Null(updated!.Code);
    }

    [Fact]
    public async Task Update_NullCode_LeavesItAlone()
    {
        var item = await _svc.Create("电池", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0001");

        var updated = await _svc.Update(item.Id, quantity: 3); // 没传 code

        Assert.Equal("BAT-LIPO-6S3300MAH-2026-0001", updated!.Code);
    }

    [Fact]
    public async Task MultipleItemsWithoutCode_AreAllowed()
    {
        // SQLite 唯一索引允许多个 NULL：一堆还没贴标的物料不能互相冲突
        await _svc.Create("件1", "其他", 1);
        await _svc.Create("件2", "其他", 1);

        Assert.Equal(2, await _db.InventoryItems.CountAsync(i => i.Code == null));
    }

    // ── 按编码查（扫码落地页）──

    [Fact]
    public async Task GetByCode_IsCaseInsensitive()
    {
        await _svc.Create("电池", "电池电源", 1, code: "BAT-LIPO-6S3300MAH-2026-0001");

        Assert.NotNull(await _svc.GetByCode("bat-lipo-6s3300mah-2026-0001"));
        Assert.NotNull(await _svc.GetByCode("  BAT-LIPO-6S3300MAH-2026-0001  "));
    }

    [Fact]
    public async Task GetByCode_Unknown_ReturnsNull()
    {
        Assert.Null(await _svc.GetByCode("NOPE-2026-0001"));
        Assert.Null(await _svc.GetByCode(""));
    }

    // ── 库存页搜索框也要能搜编码（扫码枪/粘贴编码后直接搜）──

    [Fact]
    public async Task GetAll_SearchMatchesCode_CaseInsensitively()
    {
        await _svc.Create("3S 3300mAh 电池", "电池电源", 4, code: "BAT-LIPO-6S3300MAH-2026-0007");

        // 库里存的是全大写，而 EF 把 Contains 翻译成大小写敏感的 instr()，
        // 所以这里刻意用小写搜 —— 手输与扫码枪都可能是任意大小写
        Assert.Single(await _svc.GetAll("bat-lipo", null));
        Assert.Single(await _svc.GetAll("6s3300mah-2026-0007", null));
        // 原来的按名称搜不受影响
        Assert.Single(await _svc.GetAll("电池", null));
        Assert.Empty(await _svc.GetAll("不存在的编码", null));
    }

    // ── 库位编码可以留空 ──

    [Fact]
    public async Task Create_BlankLocation_BecomesNull()
    {
        var item = await _svc.Create("先不归位", "其他", 1, locationCode: "   ");

        Assert.Null(item.LocationCode);
    }

    [Fact]
    public async Task Update_EmptyLocation_ClearsIt()
    {
        var item = await _svc.Create("桨叶", "动力系统", 1, locationCode: "201-A-3-05");

        var updated = await _svc.Update(item.Id, locationCode: "");

        // 空串 = 明确清空（null 才是"本次不改"）
        Assert.Null(updated!.LocationCode);
    }

    [Fact]
    public async Task Update_NullLocation_LeavesItAlone()
    {
        var item = await _svc.Create("桨叶", "动力系统", 1, locationCode: "201-A-3-05");

        var updated = await _svc.Update(item.Id, quantity: 4);

        Assert.Equal("201-A-3-05", updated!.LocationCode);
    }
}
