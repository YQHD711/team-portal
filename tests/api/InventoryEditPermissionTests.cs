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
/// 物料的改/删权限。
///
/// 演变：原先按"物料归属部门"判定（部长只能动本部门的）。归属部门移除后判定依据
/// 没了，最终定为——**改 = 管理员 + 部长**（物料是队内共享资源，部长要能订正字段，
/// 也要能在物料布局页把物料归位）；**删 = 仅管理员**（改错了能改回来，删了连带
/// 领用/盘点记录一起没了）。
/// </summary>
public class InventoryEditPermissionTests
{
    private static ClaimsPrincipal Actor(string role) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));

    [Fact]
    public void Modify_AdminAndHead_Delete_AdminOnly()
    {
        Assert.True(InventoryEndpoints.CanModifyItem(Actor("admin")));
        Assert.True(InventoryEndpoints.CanModifyItem(Actor("部长")));
        Assert.False(InventoryEndpoints.CanModifyItem(Actor("member")));
        Assert.False(InventoryEndpoints.CanModifyItem(new ClaimsPrincipal(new ClaimsIdentity())));

        Assert.True(InventoryEndpoints.CanDeleteItem(Actor("admin")));
        Assert.False(InventoryEndpoints.CanDeleteItem(Actor("部长")));
        Assert.False(InventoryEndpoints.CanDeleteItem(Actor("member")));
    }
}

/// <summary>
/// 端到端确认权限真的落在接口上（只测服务层会漏掉接口那一层 —— 短链地址的 bug
/// 就是这么溜过去的）。
/// </summary>
public class InventoryEditPermissionEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public InventoryEditPermissionEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    /// <summary>起一个测试宿主、塞一个指定角色的用户和一件物料，返回已登录的 client</summary>
    private async Task<(HttpClient Client, int ItemId)> SetupAsync(string dbPath, string username, string role)
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
            // 部门必须先落库：User.DepartmentId 是 FK，拿未保存的 dept.Id（0）会违反约束
            var dept = new Department { Name = "飞训部" };
            seed.Departments.Add(dept);
            await seed.SaveChangesAsync();

            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
                DepartmentId = dept.Id,
            });
            var item = new InventoryItem
            {
                Name = "桨叶", Category = "动力系统", Quantity = 5, Grade = "B", UnitPrice = 45,
                Code = "PW-PROP-9450-2026-0001", LocationCode = "201-A-3-05",
            };
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
    public async Task DepartmentHead_CanChangeNamePriceCodeAndLocation()
    {
        // 这是明确要求的能力：部长要能订正名称/单价/编码，库位则是物料布局页归位所用
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath, "head", "部长");

            var put = await client.PutAsJsonAsync($"/api/inventory/{itemId}", new
            {
                name = "桨叶（新规格）",
                unitPrice = 60m,
                code = "PW-PROP-9450-2026-0002",
                locationCode = "201-B-1-01",
            });
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);

            var after = await client.GetFromJsonAsync<InventoryItem>($"/api/inventory/{itemId}");
            Assert.Equal("桨叶（新规格）", after!.Name);
            Assert.Equal(60m, after.UnitPrice);
            Assert.Equal("PW-PROP-9450-2026-0002", after.Code);
            Assert.Equal("201-B-1-01", after.LocationCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DepartmentHead_StillCanCreate()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, _) = await SetupAsync(dbPath, "head", "部长");

            var res = await client.PostAsJsonAsync("/api/inventory", new { name = "新件", category = "耗材", quantity = 1 });

            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DepartmentHead_CannotDeleteItems()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath, "head", "部长");

            var del = await client.DeleteAsync($"/api/inventory/{itemId}");
            Assert.Equal(HttpStatusCode.Forbidden, del.StatusCode);

            // 确认物料还在
            Assert.NotNull(await client.GetFromJsonAsync<InventoryItem>($"/api/inventory/{itemId}"));
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Admin_CanModifyAndDeleteItems()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath, "boss", "admin");

            var put = await client.PutAsJsonAsync($"/api/inventory/{itemId}", new { grade = "A" });
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);

            var del = await client.DeleteAsync($"/api/inventory/{itemId}");
            Assert.Equal(HttpStatusCode.OK, del.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Member_CannotModifyOrDeleteItems()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-perm-{Guid.NewGuid():N}.db");
        try
        {
            var (client, itemId) = await SetupAsync(dbPath, "member", "member");

            Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync($"/api/inventory/{itemId}", new { grade = "A" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.DeleteAsync($"/api/inventory/{itemId}")).StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
