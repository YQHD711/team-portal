using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>盘点流程状态机:暂停/恢复/取消/删除/两步合并/盘面编辑(增删项/改派)。</summary>
public class StocktakeFlowTests
{
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        ctx.Users.AddRange(
            new User { Id = 1, Username = "member", PasswordHash = "x", Role = "member", DepartmentId = null },
            new User { Id = 2, Username = "admin", PasswordHash = "x", Role = "admin", DepartmentId = null }
        );
        ctx.SaveChanges();
        ctx.InventoryItems.AddRange(
            new InventoryItem { Id = 1, Name = "A1", Grade = "A", Quantity = 5 },
            new InventoryItem { Id = 2, Name = "A2", Grade = "A", Quantity = 3 },
            new InventoryItem { Id = 3, Name = "A3", Grade = "A", Quantity = 7 },
            new InventoryItem { Id = 4, Name = "B1", Grade = "B", Quantity = 9 }
        );
        ctx.SaveChanges();
        return ctx;
    }

    private static async Task<Stocktake> StartA(AppDbContext db, MaterialService svc) => await svc.StartStocktake("weekly", "A", 2);

    [Fact]
    public async Task Pause_BlocksMemberSubmit_Resume_Allows()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc);
        var item = await db.StocktakeItems.FirstAsync(si => si.StocktakeId == st.Id);
        item.CheckedByUserId = 1;
        await db.SaveChangesAsync();

        await svc.PauseStocktake(st.Id);
        Assert.Equal("paused", (await db.Stocktakes.FindAsync(st.Id))!.Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.BatchCheckStocktakeItems(st.Id, 1, new List<StocktakeItemResult> { new(item.InventoryItemId, 4, null) }));

        await svc.ResumeStocktake(st.Id);
        Assert.Equal("in_progress", (await db.Stocktakes.FindAsync(st.Id))!.Status);
        await svc.BatchCheckStocktakeItems(st.Id, 1, new List<StocktakeItemResult> { new(item.InventoryItemId, 4, null) });
        var si = await db.StocktakeItems.FirstAsync(x => x.StocktakeId == st.Id && x.InventoryItemId == item.InventoryItemId);
        Assert.Equal(4, si.ActualQty);
    }

    [Fact]
    public async Task Cancel_SetsCancelled_AndBlocksEdit()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc);
        await svc.CancelStocktake(st.Id);
        Assert.Equal("cancelled", (await db.Stocktakes.FindAsync(st.Id))!.Status);
        // 作废后不可再编辑实盘
        var si = await svc.UpdateStocktakeItem(st.Id, 1, 4, null, 2);
        Assert.Null(si);
    }

    [Fact]
    public async Task Delete_RemovesBeforeMerge_NotAfter()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc);
        Assert.True(await svc.DeleteStocktake(st.Id));
        Assert.Null(await db.Stocktakes.FindAsync(st.Id));
        Assert.Empty(await db.StocktakeItems.Where(x => x.StocktakeId == st.Id).ToListAsync());

        // 已合并(completed)不可删
        var st2 = await StartA(db, svc);
        var items = await db.StocktakeItems.Where(si => si.StocktakeId == st2.Id).ToListAsync();
        foreach (var it in items) { it.ActualQty = it.SystemQty; it.Difference = 0; }
        await db.SaveChangesAsync();
        await svc.FinalizeStocktake(st2.Id);
        await svc.MergeStocktake(st2.Id);
        Assert.False(await svc.DeleteStocktake(st2.Id));
        Assert.NotNull(await db.Stocktakes.FindAsync(st2.Id));
    }

    [Fact]
    public async Task Finalize_RequiresAllCounted()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc); // 3 项都未盘
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.FinalizeStocktake(st.Id));
    }

    [Fact]
    public async Task Merge_OnlyFromPendingMerge()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc);
        Assert.Null(await svc.MergeStocktake(st.Id)); // 还在进行中,不可合并
    }

    [Fact]
    public async Task Reassign_ClearsActualAndNote()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc);
        var item = await db.StocktakeItems.FirstAsync(si => si.StocktakeId == st.Id);
        item.CheckedByUserId = 1; item.ActualQty = 99; item.Difference = 94; item.Note = "旧值";
        await db.SaveChangesAsync();

        var si = await svc.ReassignStocktakeItem(st.Id, item.InventoryItemId, 2);
        Assert.NotNull(si);
        Assert.Equal(2, si!.CheckedByUserId);
        Assert.Null(si.ActualQty);
        Assert.Null(si.Difference);
        Assert.Null(si.Note);
    }

    [Fact]
    public async Task AddRemove_Item_Scope()
    {
        var db = CreateContext();
        var svc = new MaterialService(db);
        var st = await StartA(db, svc); // 已含全部 A(1,2,3)
        Assert.Null(await svc.AddStocktakeItem(st.Id, 1)); // 已含 → null
        Assert.Null(await svc.AddStocktakeItem(st.Id, 4)); // B 级等级不符 → null

        // 发起后再补一件 A 级零件 → 可加入
        db.InventoryItems.Add(new InventoryItem { Id = 5, Name = "A5", Grade = "A", Quantity = 11 });
        await db.SaveChangesAsync();
        var added = await svc.AddStocktakeItem(st.Id, 5);
        Assert.NotNull(added);
        Assert.Equal(11, added!.SystemQty);

        // 移除
        Assert.True(await svc.RemoveStocktakeItem(st.Id, 5));
        Assert.Null(await db.StocktakeItems.FirstOrDefaultAsync(x => x.StocktakeId == st.Id && x.InventoryItemId == 5));
    }
}
