using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 审计 #6 的**端到端**负向测试：归还数量越界必须 400，且**库存不变**。
/// 修复前（只有 `Quantity &gt; 0` 校验）这里会返回 200 并把 int.MaxValue 写进库，
/// 之后任何整表读取都会 OverflowException（全站库存不可用）→ 这条测试修复前必红。
/// </summary>
public class InventoryQuantityBoundTests
{
    private sealed record LoginResp(string Token);

    private const string JwtKey = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";   // = new string('k', 40)

    private static string MakeToken(int userId, string username, string role)
    {
        var creds = new Microsoft.IdentityModel.Tokens.SigningCredentials(
            new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(JwtKey)),
            Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256);
        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(
            issuer: "TeamPortal", audience: "TeamPortal",
            claims:
            [
                new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, userId.ToString()),
                new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, username),
                new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, role),
            ],
            expires: DateTime.UtcNow.AddDays(1), signingCredentials: creds);
        return new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(token);
    }

    private static async Task<(HttpClient Client, int ItemId, string DbPath)> SetupAsync()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-qty-{Guid.NewGuid():N}.db");
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", JwtKey);
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        });
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        int itemId;
        var bossName = "qty-" + Guid.NewGuid().ToString("N")[..8];
        await using (var seed = new AppDbContext(opts))
        {
            var boss = new User
            {
                Username = bossName,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"), Role = "admin",
            };
            seed.Users.Add(boss);
            var item = new InventoryItem
            {
                Name = "上界测试件", Category = "测试", Quantity = 5, Grade = "B",
                Code = "QTY-" + Guid.NewGuid().ToString("N")[..8],
            };
            seed.InventoryItems.Add(item);
            await seed.SaveChangesAsync();
            itemId = item.Id;
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = bossName, password = "pw123456" });
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())?.Token ?? "";
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, itemId, dbPath);
    }

    [Fact]
    public async Task Checkin_IntMaxValue_IsRejected_AndStockUnchanged()
    {
        var (client, itemId, dbPath) = await SetupAsync();

        var res = await client.PostAsJsonAsync($"/api/inventory/{itemId}/checkin", new { quantity = int.MaxValue });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);       // 修复前是 200
        Assert.Contains("数量过大", await res.Content.ReadAsStringAsync());

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        var item = await db.InventoryItems.AsNoTracking().FirstAsync(i => i.Id == itemId);
        Assert.Equal(5, item.Quantity);                                // 库存必须没被改动
    }

    [Fact]
    public async Task Checkin_NegativeQuantity_IsRejected()
    {
        var (client, itemId, _) = await SetupAsync();

        var res = await client.PostAsJsonAsync($"/api/inventory/{itemId}/checkin", new { quantity = -1 });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Checkout_HugeQuantity_IsRejected_WithReadableReason()
    {
        var (client, itemId, _) = await SetupAsync();

        var res = await client.PostAsJsonAsync($"/api/inventory/{itemId}/checkout", new { quantity = int.MaxValue });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(body));
    }

    [Fact]
    public async Task Checkin_NormalQuantity_StillWorks()
    {
        // 不改变正常路径：合法归还仍然成功
        var (client, itemId, dbPath) = await SetupAsync();

        var res = await client.PostAsJsonAsync($"/api/inventory/{itemId}/checkin", new { quantity = 3 });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        var item = await db.InventoryItems.AsNoTracking().FirstAsync(i => i.Id == itemId);
        Assert.Equal(8, item.Quantity);
    }
}
