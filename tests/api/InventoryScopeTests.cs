using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 库存的部门范围授权:部长只能改/删/借出本部门零件(共享件除外)。
/// 旧实现只判 IsStaff(role),部长可改他部门零件的数量与单价、甚至删除。
/// </summary>
public class InventoryScopeTests
{
    private static AppDbContext CreateDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ClaimsPrincipal Actor(string role, int userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.Role, role),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    private static async Task<(AppDbContext Db, int FlightDeptId, int OrgDeptId, int FlightHeadId)> SeedAsync()
    {
        var db = CreateDb();
        var flight = new Department { Name = "飞训部" };
        var org = new Department { Name = "组织部" };
        db.Departments.AddRange(flight, org);
        await db.SaveChangesAsync();
        var head = new User { Username = "head", PasswordHash = "x", Role = "部长", DepartmentId = flight.Id };
        db.Users.Add(head);
        await db.SaveChangesAsync();
        return (db, flight.Id, org.Id, head.Id);
    }

    [Fact]
    public async Task DepartmentHead_CanOnlyManageOwnDepartmentItems()
    {
        var (db, flightDeptId, orgDeptId, headId) = await SeedAsync();
        var head = Actor("部长", headId);

        Assert.True(await InventoryEndpoints.CanManageItemAsync(head, db, new InventoryItem { Name = "A", DepartmentId = flightDeptId }));
        Assert.False(await InventoryEndpoints.CanManageItemAsync(head, db, new InventoryItem { Name = "B", DepartmentId = orgDeptId }));
        // 未指定部门的共享件仍由 staff 管理(保持既有共享池语义)
        Assert.True(await InventoryEndpoints.CanManageItemAsync(head, db, new InventoryItem { Name = "C", DepartmentId = null }));
    }

    [Fact]
    public async Task Admin_CanManageAnyItem()
    {
        var (db, flightDeptId, orgDeptId, _) = await SeedAsync();

        Assert.True(await InventoryEndpoints.CanManageItemAsync(Actor("admin", 1), db, new InventoryItem { Name = "B", DepartmentId = orgDeptId }));
        Assert.True(await InventoryEndpoints.CanManageItemAsync(Actor("admin", 1), db, new InventoryItem { Name = "A", DepartmentId = flightDeptId }));
    }

    [Fact]
    public async Task Member_CannotManageAnyItem()
    {
        var (db, flightDeptId, _, headId) = await SeedAsync();

        Assert.False(await InventoryEndpoints.CanManageItemAsync(Actor("member", headId), db, new InventoryItem { Name = "A", DepartmentId = flightDeptId }));
        Assert.False(await InventoryEndpoints.CanManageItemAsync(Actor("member", headId), db, new InventoryItem { Name = "C", DepartmentId = null }));
    }

    [Fact]
    public async Task UnknownUser_IsDenied()
    {
        var (db, flightDeptId, _, _) = await SeedAsync();

        Assert.False(await InventoryEndpoints.CanManageItemAsync(Actor("部长", 9999), db, new InventoryItem { Name = "A", DepartmentId = flightDeptId }));
    }
}
