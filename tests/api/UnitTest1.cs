using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

public class CalcGradeTests
{
    [Theory]
    [InlineData(1000, "A")]
    [InlineData(1500, "A")]
    [InlineData(9999, "A")]
    [InlineData(100, "B")]
    [InlineData(500, "B")]
    [InlineData(999, "B")]
    [InlineData(0, "C")]
    [InlineData(50, "C")]
    [InlineData(99, "C")]
    public void CalcGrade_AutoFromPrice(decimal price, string expected)
    {
        Assert.Equal(expected, InventoryService.CalcGrade(price));
    }

    [Fact]
    public void CalcGrade_ZeroPrice_ReturnsC()
    {
        Assert.Equal("C", InventoryService.CalcGrade(0));
    }

    [Fact]
    public void CalcGrade_Boundary_999_returns_B()
    {
        Assert.Equal("B", InventoryService.CalcGrade(999));
    }

    [Fact]
    public void CalcGrade_Boundary_1000_returns_A()
    {
        Assert.Equal("A", InventoryService.CalcGrade(1000));
    }
}

public class MaterialServiceTests
{
    private AppDbContext CreateContext()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task CreateCheckout_GradeC_AutoApproves()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "螺丝", Grade = "C", Quantity = 100, UnitPrice = 0.5m });
        await db.SaveChangesAsync();

        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 10, "test");

        Assert.Equal("approved", req.Status);
        Assert.Equal("C", req.Grade);
        // 库存已扣
        var item = await db.InventoryItems.FindAsync(1);
        Assert.Equal(90, item!.Quantity);
    }

    [Fact]
    public async Task CreateCheckout_GradeB_RequiresDeptApproval()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();

        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 3, "test");

        Assert.Equal("pending_dept", req.Status);
        Assert.Equal("B", req.Grade);
        // 库存未扣
        var item = await db.InventoryItems.FindAsync(1);
        Assert.Equal(20, item!.Quantity);
    }

    [Fact]
    public async Task CreateCheckout_GradeA_RequiresDeptApproval()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();

        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 1, "test");

        Assert.Equal("pending_dept", req.Status);
        Assert.Equal("A", req.Grade);
    }

    [Fact]
    public async Task ApproveDept_GradeB_GoesToApproved()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 3, "test");
        Assert.Equal("pending_dept", req.Status);

        var result = await svc.ApproveDept(req.Id, 10);
        Assert.NotNull(result);
        Assert.Equal("approved", result!.Status);
        // 库存此时才扣
        var item = await db.InventoryItems.FindAsync(1);
        Assert.Equal(17, item!.Quantity);
    }

    [Fact]
    public async Task ApproveDept_GradeA_GoesToPendingAdmin()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 1, "test");

        var result = await svc.ApproveDept(req.Id, 10);
        Assert.NotNull(result);
        Assert.Equal("pending_admin", result!.Status);
        // 库存还没扣
        var item = await db.InventoryItems.FindAsync(1);
        Assert.Equal(5, item!.Quantity);
    }

    [Fact]
    public async Task ApproveAdmin_GradeA_GoesToApproved()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 1, "test");
        await svc.ApproveDept(req.Id, 10);
        Assert.Equal("pending_admin", req.Status);

        var result = await svc.ApproveAdmin(req.Id, 20);
        Assert.NotNull(result);
        Assert.Equal("approved", result!.Status);
        var item = await db.InventoryItems.FindAsync(1);
        Assert.Equal(4, item!.Quantity);
    }

    [Fact]
    public async Task RejectRequest_Works()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 3, "test");

        var result = await svc.RejectRequest(req.Id, 10, "不需要");
        Assert.NotNull(result);
        Assert.Equal("rejected", result!.Status);
        Assert.Equal("不需要", result.RejectReason);
    }

    [Fact]
    public async Task CreateCheckout_InsufficientStock_Throws()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "螺丝", Grade = "C", Quantity = 2 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CreateCheckout(1, 1, 10, "test"));
    }

    [Fact]
    public async Task Checkin_GradeA_RequiresPhoto()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var req = await svc.CreateCheckout(1, 1, 1, "test");
        await svc.ApproveDept(req.Id, 10);
        await svc.ApproveAdmin(req.Id, 20);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.Checkin(req.Id, 1, "normal", false, null, null));
    }

    [Fact]
    public async Task Stocktake_AutoAssign_EvenlyDistributes()
    {
        var db = CreateContext();
        db.InventoryItems.AddRange(
            new InventoryItem { Id = 1, Name = "A1", Grade = "A", Quantity = 5 },
            new InventoryItem { Id = 2, Name = "A2", Grade = "A", Quantity = 3 },
            new InventoryItem { Id = 3, Name = "A3", Grade = "A", Quantity = 2 },
            new InventoryItem { Id = 4, Name = "A4", Grade = "A", Quantity = 1 }
        );
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var st = await svc.StartStocktake("weekly", "A", 1);

        await svc.AutoAssignStocktake(st.Id, new List<int> { 10, 20 });
        // 4 items assigned to 2 members
        var items = await db.StocktakeItems.Where(si => si.StocktakeId == st.Id).ToListAsync();
        Assert.All(items, si => Assert.NotNull(si.CheckedByUserId));
        Assert.Equal(4, items.Count);
        Assert.Contains(items, si => si.CheckedByUserId == 10);
        Assert.Contains(items, si => si.CheckedByUserId == 20);
    }

    [Fact]
    public async Task CompleteStocktake_AdjustsInventory()
    {
        var db = CreateContext();
        db.InventoryItems.AddRange(
            new InventoryItem { Id = 1, Name = "A1", Grade = "A", Quantity = 5 },
            new InventoryItem { Id = 2, Name = "A2", Grade = "A", Quantity = 3 }
        );
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);
        var st = await svc.StartStocktake("weekly", "A", 1);

        // Simulate counting: A1 found 4 (loss 1), A2 found 5 (gain 2)
        await svc.UpdateStocktakeItem(st.Id, 1, 4, null, 1);
        await svc.UpdateStocktakeItem(st.Id, 2, 5, null, 1);
        await svc.CompleteStocktake(st.Id);

        var item1 = await db.InventoryItems.FindAsync(1);
        var item2 = await db.InventoryItems.FindAsync(2);
        Assert.Equal(4, item1!.Quantity);
        Assert.Equal(5, item2!.Quantity);
    }

    [Fact]
    public async Task BatchCheck_FullMemberSubmitFlow()
    {
        var db = CreateContext();
        db.InventoryItems.AddRange(
            new InventoryItem { Id = 1, Name = "A1", Grade = "A", Quantity = 10 },
            new InventoryItem { Id = 2, Name = "A2", Grade = "A", Quantity = 8 }
        );
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);

        // Admin creates and assigns
        var st = await svc.StartStocktake("weekly", "A", 1);
        // Manually assign (avoid Random.Shared in test)
        var items = await db.StocktakeItems.Where(si => si.StocktakeId == st.Id).ToListAsync();
        items[0].CheckedByUserId = 10;
        items[1].CheckedByUserId = 20;
        await db.SaveChangesAsync();

        // Member 10 submits via batch
        await svc.BatchCheckStocktakeItems(st.Id, 10, new List<StocktakeItemResult>
        {
            new(items[0].InventoryItemId, 12, "多了2个")
        });

        // Member 20 submits
        await svc.BatchCheckStocktakeItems(st.Id, 20, new List<StocktakeItemResult>
        {
            new(items[1].InventoryItemId, 7, "少了1个")
        });

        // Verify all submitted
        var allItems = await db.StocktakeItems.Where(si => si.StocktakeId == st.Id).ToListAsync();
        Assert.All(allItems, si => Assert.NotNull(si.ActualQty));
        Assert.Equal(12, allItems[0].ActualQty);
        Assert.Equal(7, allItems[1].ActualQty);

        // Admin completes
        await svc.CompleteStocktake(st.Id);
        Assert.Equal("completed", (await db.Stocktakes.FindAsync(st.Id))!.Status);

        // Inventory updated
        Assert.Equal(12, (await db.InventoryItems.FindAsync(1))!.Quantity);
        Assert.Equal(7, (await db.InventoryItems.FindAsync(2))!.Quantity);
    }

    [Fact]
    public async Task BatchCheck_UnauthorizedMemberIgnored()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "A1", Grade = "A", Quantity = 10 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);
        var st = await svc.StartStocktake("weekly", "A", 1);
        var item = await db.StocktakeItems.FirstAsync(si => si.StocktakeId == st.Id);
        item.CheckedByUserId = 10;
        await db.SaveChangesAsync();

        // Unauthorized member 99 tries to submit
        await svc.BatchCheckStocktakeItems(st.Id, 99, new List<StocktakeItemResult>
        {
            new(item.InventoryItemId, 999, "hack")
        });

        // No change
        var si = await db.StocktakeItems.FirstAsync(s => s.StocktakeId == st.Id);
        Assert.Null(si.ActualQty);
    }

    [Fact]
    public async Task DamageReport_MustHaveDescription()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 2 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db, null!, null!);

        var report = await svc.CreateDamageReport(1, 1, "damage", "飞行中失控坠毁", true);
        Assert.Equal("damage", report.Type);
        Assert.True(report.IsApprovedTest);
        Assert.Equal("pending", report.Liability);

        var resolved = await svc.ResolveDamageReport(report.Id, "exempt", null, "经批准测试，免责");
        Assert.Equal("exempt", resolved!.Liability);
    }
}
