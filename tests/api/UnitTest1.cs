using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
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

/// <summary>
/// 领用审批流转:审批人以【申请人所在部门】为准。
///   - 部门存在部长 → pending_dept(部长审;A 再进 admin 终审)
///   - 未分配部门 / 部门无部长 → pending_admin(admin 一次性批)
/// </summary>
public class MaterialServiceTests
{
    private AppDbContext CreateContext()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new AppDbContext(opts);
        context.Database.EnsureCreated();

        context.Departments.AddRange(
            new Department { Id = 1, Name = "飞控部" },
            new Department { Id = 2, Name = "无部长部" }
        );
        context.SaveChanges();
        context.Users.AddRange(
            new User { Id = 1, Username = "requester", PasswordHash = "x", Role = "member", DepartmentId = 1 },
            new User { Id = 2, Username = "admin", PasswordHash = "x", Role = "admin", DepartmentId = null },
            new User { Id = 3, Username = "leader", PasswordHash = "x", Role = "部长", DepartmentId = 1 },
            new User { Id = 4, Username = "noleader", PasswordHash = "x", Role = "member", DepartmentId = 2 },
            new User { Id = 5, Username = "unassigned", PasswordHash = "x", Role = "member", DepartmentId = null }
        );
        context.SaveChanges();
        return context;
    }

    private static async Task<CheckoutRequest> RequestAsync(AppDbContext db, int userId, int itemId, int qty)
    {
        var svc = new MaterialService(db);
        return await svc.CreateCheckout(itemId, userId, qty, "test");
    }

    [Fact]
    public async Task CreateCheckout_GradeC_AutoApproves()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "螺丝", Grade = "C", Quantity = 100, UnitPrice = 0.5m });
        await db.SaveChangesAsync();

        var req = await RequestAsync(db, 1, 1, 10);

        Assert.Equal("approved", req.Status);
        db.ChangeTracker.Clear();
        Assert.Equal(90, (await db.InventoryItems.FindAsync(1))!.Quantity);
    }

    [Fact]
    public async Task CreateCheckout_GradeB_RequiresDeptApproval()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();

        // 申请人 id1 属飞控部且有部长 → pending_dept
        var req = await RequestAsync(db, 1, 1, 3);

        Assert.Equal("pending_dept", req.Status);
        var item = await db.InventoryItems.FindAsync(1);
        Assert.Equal(20, item!.Quantity);
    }

    [Fact]
    public async Task CreateCheckout_GradeA_RequiresDeptApproval()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();

        var req = await RequestAsync(db, 1, 1, 1);

        Assert.Equal("pending_dept", req.Status);
    }

    [Fact]
    public async Task CreateCheckout_GradeB_UnassignedDept_GoesToAdmin()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();

        // id5 未分配部门 → 跳过部长,直接管理员
        var req = await RequestAsync(db, 5, 1, 3);
        Assert.Equal("pending_admin", req.Status);
        Assert.Equal(20, (await db.InventoryItems.FindAsync(1))!.Quantity);
    }

    [Fact]
    public async Task CreateCheckout_GradeB_DeptWithoutLeader_GoesToAdmin()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();

        // id4 属“无部长部” → 无人批,直接管理员
        var req = await RequestAsync(db, 4, 1, 3);
        Assert.Equal("pending_admin", req.Status);
    }

    [Fact]
    public async Task ApproveDept_GradeB_GoesToApproved()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();
        var req = await RequestAsync(db, 1, 1, 3);
        Assert.Equal("pending_dept", req.Status);

        var svc = new MaterialService(db);
        var result = await svc.ApproveDept(req.Id, 3);
        Assert.NotNull(result);
        Assert.Equal("approved", result!.Status);
        db.ChangeTracker.Clear();
        Assert.Equal(17, (await db.InventoryItems.FindAsync(1))!.Quantity);
    }

    [Fact]
    public async Task ApproveDept_GradeA_GoesToPendingAdmin()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();
        var req = await RequestAsync(db, 1, 1, 1);

        var result = await new MaterialService(db).ApproveDept(req.Id, 3);
        Assert.NotNull(result);
        Assert.Equal("pending_admin", result!.Status);
        Assert.Equal(5, (await db.InventoryItems.FindAsync(1))!.Quantity);
    }

    [Fact]
    public async Task ApproveAdmin_GradeA_GoesToApproved()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);
        var req = await RequestAsync(db, 1, 1, 1);
        await svc.ApproveDept(req.Id, 3);
        Assert.Equal("pending_admin", req.Status);

        var result = await svc.ApproveAdmin(req.Id, 2);
        Assert.NotNull(result);
        Assert.Equal("approved", result!.Status);
        db.ChangeTracker.Clear();
        Assert.Equal(4, (await db.InventoryItems.FindAsync(1))!.Quantity);
    }

    [Fact]
    public async Task ApproveAdmin_GradeB_FromUnassigned_DeductsStock()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20, UnitPrice = 500 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);
        var req = await RequestAsync(db, 5, 1, 3); // 未分配部门 → pending_admin
        Assert.Equal("pending_admin", req.Status);

        var result = await svc.ApproveAdmin(req.Id, 2);
        Assert.NotNull(result);
        Assert.Equal("approved", result!.Status);
        db.ChangeTracker.Clear();
        Assert.Equal(17, (await db.InventoryItems.FindAsync(1))!.Quantity);
    }

    [Fact]
    public async Task RejectRequest_Works()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 20 });
        await db.SaveChangesAsync();
        var req = await RequestAsync(db, 1, 1, 3);

        var result = await new MaterialService(db).RejectRequest(req.Id, 3, "不需要");
        Assert.NotNull(result);
        Assert.Equal("rejected", result!.Status);
        Assert.Equal("不需要", result.RejectReason);
    }

    [Fact]
    public async Task GetPendingRequests_DeptHead_SeesOwnDeptMembers()
    {
        var db = CreateContext();
        db.InventoryItems.AddRange(
            new InventoryItem { Id = 1, Name = "电机A", Grade = "B", Quantity = 20 },
            new InventoryItem { Id = 2, Name = "电机B", Grade = "B", Quantity = 20 }
        );
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);
        var own = await RequestAsync(db, 1, 1, 1);   // 飞控部成员 → pending_dept
        var un = await RequestAsync(db, 5, 2, 1);    // 未分配 → pending_admin
        Assert.Equal("pending_dept", own.Status);
        Assert.Equal("pending_admin", un.Status);

        var leaderQueue = await svc.GetPendingRequests("部长", null, 1);
        Assert.Single(leaderQueue);
        Assert.Equal(own.Id, leaderQueue[0].Id);

        var adminQueue = await svc.GetPendingRequests("admin", null, null);
        Assert.Single(adminQueue);
        Assert.Equal(un.Id, adminQueue[0].Id);
    }

    [Fact]
    public async Task CreateCheckout_InsufficientStock_Throws()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "螺丝", Grade = "C", Quantity = 2 });
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => RequestAsync(db, 1, 1, 10));
    }

    [Fact]
    public async Task Checkin_GradeA_RequiresPhoto()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 5, UnitPrice = 2000 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);
        var req = await RequestAsync(db, 1, 1, 1);
        await svc.ApproveDept(req.Id, 3);
        await svc.ApproveAdmin(req.Id, 2);

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
        var svc = new MaterialService(db);
        var st = await svc.StartStocktake("weekly", "A", 2);

        await svc.AutoAssignStocktake(st.Id, new List<int> { 4, 5 });
        var items = await db.StocktakeItems.Where(si => si.StocktakeId == st.Id).ToListAsync();
        Assert.Equal(4, items.Count);
        Assert.All(items, si => Assert.NotNull(si.CheckedByUserId));
        Assert.Contains(items, si => si.CheckedByUserId == 4);
        Assert.Contains(items, si => si.CheckedByUserId == 5);
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
        var svc = new MaterialService(db);
        var st = await svc.StartStocktake("weekly", "A", 2);

        await svc.UpdateStocktakeItem(st.Id, 1, 4, null, 2);
        await svc.UpdateStocktakeItem(st.Id, 2, 5, null, 2);
        await svc.CompleteStocktake(st.Id);

        Assert.Equal(4, (await db.InventoryItems.FindAsync(1))!.Quantity);
        Assert.Equal(5, (await db.InventoryItems.FindAsync(2))!.Quantity);
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
        var st = await svc.StartStocktake("weekly", "A", 2);

        var items = await db.StocktakeItems.Where(si => si.StocktakeId == st.Id).ToListAsync();
        items[0].CheckedByUserId = 4;
        items[1].CheckedByUserId = 5;
        await db.SaveChangesAsync();

        await svc.BatchCheckStocktakeItems(st.Id, 4, new List<StocktakeItemResult> { new(items[0].InventoryItemId, 12, "多了2个") });
        await svc.BatchCheckStocktakeItems(st.Id, 5, new List<StocktakeItemResult> { new(items[1].InventoryItemId, 7, "少了1个") });

        var allItems = await db.StocktakeItems.Where(si => si.StocktakeId == st.Id).ToListAsync();
        Assert.All(allItems, si => Assert.NotNull(si.ActualQty));
        Assert.Equal(12, allItems[0].ActualQty);
        Assert.Equal(7, allItems[1].ActualQty);

        await svc.CompleteStocktake(st.Id);
        Assert.Equal("completed", (await db.Stocktakes.FindAsync(st.Id))!.Status);
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
        var st = await svc.StartStocktake("weekly", "A", 2);
        var item = await db.StocktakeItems.FirstAsync(si => si.StocktakeId == st.Id);
        item.CheckedByUserId = 4;
        await db.SaveChangesAsync();

        await svc.BatchCheckStocktakeItems(st.Id, 99, new List<StocktakeItemResult> { new(item.InventoryItemId, 999, "hack") });

        var si = await db.StocktakeItems.FirstAsync(s => s.StocktakeId == st.Id);
        Assert.Null(si.ActualQty);
    }

    [Fact]
    public async Task DamageReport_MustHaveDescription()
    {
        var db = CreateContext();
        db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "飞控", Grade = "A", Quantity = 2 });
        await db.SaveChangesAsync();
        var svc = new MaterialService(db);

        var report = await svc.CreateDamageReport(1, 1, "damage", "飞行中失控坠毁", true);
        Assert.Equal("damage", report.Type);
        Assert.True(report.IsApprovedTest);
        Assert.Equal("pending", report.Liability);

        var resolved = await svc.ResolveDamageReport(report.Id, "exempt", null, "经批准测试，免责");
        Assert.Equal("exempt", resolved!.Liability);
    }
}
