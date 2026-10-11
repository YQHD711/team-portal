using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-14 B：实时库存/货位上下文。
///
/// 为什么不是索引：库存数量随时在变，而索引只在知识库文件变动时重建 —— 写进索引必然答过期数字。
/// 这里每次提问现查库，测试用「改库后再问拿到新值」证明"实时"。
/// 匹配是**强匹配**（完整物料名 / 完整编码 / ≥6 字符编码前缀），宁可少给也不给错。
/// </summary>
public class LiveInventoryContextTests : IDisposable
{
    private const string Layout1030 =
        """
        {"width":900,"height":600,"walls":[],"doors":[],"windows":[],
         "items":[{"id":"it1","type":"shelf","name":"A货架","locCode":"1030-A","shelfCount":4,"positionCount":8}]}
        """;

    private readonly AppDbContext _db;

    public LiveInventoryContextTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        _db.StorageLayouts.Add(new StorageLayout
        {
            RoomCode = "1030", RoomName = "库房", Floor = 1,
            CabinetCount = 4, ShelfCount = 4, PositionCount = 8,
            Description = "航模器材库房", LayoutJson = Layout1030,
        });
        _db.InventoryItems.Add(new InventoryItem
        {
            Name = "碳纤维管", Code = "EL-CFRP-2026-0001", Category = "结构件",
            Quantity = 7, LocationCode = "1030-A-1-01", Grade = "B", Status = "available",
        });
        _db.SaveChanges();
    }

    public void Dispose() { _db.Dispose(); GC.SuppressFinalize(this); }

    [Fact]
    public async Task RoomQuestion_InjectsRealRoomAndLayoutElements()
    {
        var block = await LiveInventoryContext.BuildAsync("1030 库房的货架分布？", _db);

        Assert.NotNull(block);
        Assert.Contains(LiveInventoryContext.Header, block);
        Assert.Contains("房间 1030 库房", block);
        Assert.Contains("4 货架 × 4 层 × 8 位", block);          // 真实网格
        Assert.Contains("航模器材库房", block);                   // 真实说明
        Assert.Contains("A货架", block);                          // LayoutJson 里真实存在的货架名
        Assert.Contains("1030-A", block);                         // 真实 locCode
        Assert.Contains("该房间当前挂的物料：1 件", block);
    }

    [Fact]
    public async Task RoomQuestion_ByRoomName_AlsoWorks()
        => Assert.Contains("1030", await LiveInventoryContext.BuildAsync("库房里都有些什么？", _db) ?? "");

    [Fact]
    public async Task ItemQuestion_ReturnsLiveQuantity_AndFollowsDbChanges()
    {
        var first = await LiveInventoryContext.BuildAsync("碳纤维管还剩多少？", _db);
        Assert.NotNull(first);
        Assert.Contains("碳纤维管", first);
        Assert.Contains("当前可用数量 7", first);
        Assert.Contains("1030-A-1-01", first);

        // 改库（不走任何索引）→ 再问必须拿到新值：这就是"实时"而不是"索引里写死的"
        var item = await _db.InventoryItems.SingleAsync();
        item.Quantity = 2;
        item.LocationCode = "1030-A-2-03";
        await _db.SaveChangesAsync();

        var second = await LiveInventoryContext.BuildAsync("碳纤维管还剩多少？", _db);
        Assert.NotNull(second);
        Assert.Contains("当前可用数量 2", second);
        Assert.DoesNotContain("当前可用数量 7", second);
        Assert.Contains("1030-A-2-03", second);
    }

    [Fact]
    public async Task ItemQuestion_MatchesByCodePrefix()
    {
        var block = await LiveInventoryContext.BuildAsync("EL-CFRP-2026 这个型号库存还有吗？", _db);
        Assert.Contains("碳纤维管", block ?? "");
    }

    [Fact]
    public async Task UnknownItemOrUnrelatedQuestion_ProducesNoBlock()
    {
        Assert.Null(await LiveInventoryContext.BuildAsync("Ardupilot 的 RTL 模式怎么用？", _db));      // 与库存无关
        Assert.Null(await LiveInventoryContext.BuildAsync("如何领用 B 级物料？", _db));               // 没有具体物料名 → 不猜
        Assert.Null(await LiveInventoryContext.BuildAsync("EL-MOTOR-2026-9999 还有货吗？", _db));     // 编码不存在 → 不给别的物料
        Assert.Null(await LiveInventoryContext.BuildAsync("双频段数传的波特率是多少？", _db));         // 库里没这个物料
    }

    [Fact]
    public void LayoutElements_BrokenJsonOrNoItems_IsEmptyNotThrow()
    {
        Assert.Empty(LiveInventoryContext.LayoutElements(null));
        Assert.Empty(LiveInventoryContext.LayoutElements("不是 JSON"));
        Assert.Empty(LiveInventoryContext.LayoutElements("""{"width":1}"""));
        Assert.Equal(["A货架（1030-A）：4 层 × 8 位"], LiveInventoryContext.LayoutElements(Layout1030));
    }
}
