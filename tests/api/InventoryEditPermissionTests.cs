using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 物料卡片的改/删权限。
///
/// 背景：这一层原先按"物料归属部门"判定（部长只能动本部门的）。归属部门移除后
/// 判定依据没了，按"物料是队内共享资源、部长只读"统一收成**管理员专属**。
/// 库存操作（领用/归还/消耗）不受影响 —— 那是岗位职责，仍然 staff 可用。
/// </summary>
public class InventoryEditPermissionTests
{
    private static ClaimsPrincipal Actor(string role) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));

    [Fact]
    public void CanEditItem_OnlyAdmin()
    {
        Assert.True(InventoryEndpoints.CanEditItem(Actor("admin")));
        Assert.False(InventoryEndpoints.CanEditItem(Actor("部长")));
        Assert.False(InventoryEndpoints.CanEditItem(Actor("member")));
        Assert.False(InventoryEndpoints.CanEditItem(new ClaimsPrincipal(new ClaimsIdentity())));
    }
}

/// <summary>
/// 端到端确认权限真的落在接口上（只有服务层单测会漏掉接口那一层 —— 短链地址的
/// bug 就是这么溜过去的）。
/// </summary>
public class InventoryEditPermissionEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public InventoryEditPermissionEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    private async Task<(HttpClient Client, int ItemId)> SetupAsync(string dbPath, string username)
    {
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        int itemId;
        await using (var seed = new AppDbContext(opts))
        {
            // 部门必须先落库：User.DepartmentId 是 FK，拿未保存的 dept.Id（0）会直接违反约束
            var dept = new Department { Name = "飞训部" };
            seed.Departments.Add(dept);
            await seed.SaveChangesAsync();

            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = username == "boss" ? "admin" : "部长",
                DepartmentId = dept.Id,
            });
            var item = new InventoryItem { Name = "桨叶", Category = "动力系统", Quantity = 5, Grade = "B", UnitPrice = 45 };
            seed.InventoryItems.Add(item);
            await seed.SaveChangesAsync();
            itemId = item.Id;
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, itemId);
    }

    [Fact]
    public async Task DepartmentHead_CannotModifyOrDeleteItems()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath, "head");

            // 部长即使原本是"本部门"的物料，现在也不能改
            var put = await client.PutAsJsonAsync($"/api/inventory/{itemId}", new { grade = "A" });
            Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);

            var del = await client.DeleteAsync($"/api/inventory/{itemId}");
            Assert.Equal(HttpStatusCode.Forbidden, del.StatusCode);

            // 确认真的没改掉
            var after = await client.GetFromJsonAsync<InventoryItem>($"/api/inventory/{itemId}");
            Assert.Equal("B", after!.Grade);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Admin_CanModifyAndDeleteItems()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath, "boss");

            var put = await client.PutAsJsonAsync($"/api/inventory/{itemId}", new { grade = "A" });
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);

            var del = await client.DeleteAsync($"/api/inventory/{itemId}");
            Assert.Equal(HttpStatusCode.OK, del.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Member_CannotCreateItems()
    {
        // 新增仍归 staff（部长也能建），队员不行
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, _) = await SetupAsync(dbPath, "head"); // head=部长，先确认部长能建
            var ok = await client.PostAsJsonAsync("/api/inventory", new { name = "新件", category = "耗材", quantity = 1 });
            Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
