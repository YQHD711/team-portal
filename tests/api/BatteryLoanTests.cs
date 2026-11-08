using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 电池台账 + 借还链路：单件唯一码、免审批自助借还、代借仅 staff、按码查询、超时列表。
/// </summary>
public class BatteryLoanTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public BatteryLoanTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record BatteryResp(int Id, string Code, string? Model, string Status, int? CurrentBorrowerId);
    private sealed record BorrowResp(int LoanId, int BatteryId, int BorrowerId);
    private sealed record ReturnResp(int LoanId, int BatteryId);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-bat-{Guid.NewGuid():N}.db");

    private HttpClient NewClient(string dbPath)
    {
        // 只在文件不存在时预创建：同一测试里会为 staff/member 各建一个 host，
        // 第二个 host 再写同一路径会撞上第一个 host 已打开的 SQLite 文件。
        if (!File.Exists(dbPath)) File.WriteAllBytes(dbPath, Array.Empty<byte>());
        return _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            b.ConfigureLogging(lb => lb.ClearProviders());
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private async Task<HttpClient> LoginAsync(string dbPath, string username, string role)
    {
        var client = NewClient(dbPath);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
            });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<BatteryResp> CreateBatteryAsync(HttpClient staff, string? model = null)
    {
        var res = await staff.PostAsJsonAsync("/api/battery", new { model, health = "正常", notes = (string?)null });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<BatteryResp>())!;
    }

    [Fact]
    public async Task Staff_CanCreateBattery_WithAutoCode()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batstaff", "admin");
            var first = await CreateBatteryAsync(staff);
            var second = await CreateBatteryAsync(staff);

            Assert.Equal("BAT-0001", first.Code);
            Assert.Equal("BAT-0002", second.Code);
            Assert.Equal("in_stock", first.Status);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Member_CannotCreateBattery()
    {
        var dbPath = NewDbPath();
        try
        {
            var member = await LoginAsync(dbPath, "batmember", "member");
            var res = await member.PostAsJsonAsync("/api/battery", new { model = "6S" });
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Borrow_Then_Return_ClosesLoan()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batborrow", "admin");
            var battery = await CreateBatteryAsync(staff, "6S 3300mAh");

            var borrow = await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/borrow", new { note = "周末飞" });
            Assert.Equal(HttpStatusCode.OK, borrow.StatusCode);
            var loan = (await borrow.Content.ReadFromJsonAsync<BorrowResp>())!;
            Assert.Equal(battery.Id, loan.BatteryId);

            var afterBorrow = await staff.GetFromJsonAsync<BatteryResp>($"/api/battery/{battery.Id}");
            Assert.Equal("borrowed", afterBorrow!.Status);
            Assert.NotNull(afterBorrow.CurrentBorrowerId);

            var mine = await staff.GetFromJsonAsync<List<BorrowResp>>("/api/battery/mine");
            Assert.NotNull(mine);
            Assert.Single(mine!);

            var ret = await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/return", new { note = "已还" });
            Assert.Equal(HttpStatusCode.OK, ret.StatusCode);
            var closed = (await ret.Content.ReadFromJsonAsync<ReturnResp>())!;
            Assert.Equal(loan.LoanId, closed.LoanId);

            var afterReturn = await staff.GetFromJsonAsync<BatteryResp>($"/api/battery/{battery.Id}");
            Assert.Equal("in_stock", afterReturn!.Status);
            Assert.Null(afterReturn.CurrentBorrowerId);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Borrow_Twice_Returns409()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batdouble", "admin");
            var battery = await CreateBatteryAsync(staff);
            Assert.Equal(HttpStatusCode.OK, (await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/borrow", new { })).StatusCode);

            var second = await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/borrow", new { });
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Return_When_InStock_Returns409()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batret", "admin");
            var battery = await CreateBatteryAsync(staff);
            var ret = await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/return", new { });
            Assert.Equal(HttpStatusCode.Conflict, ret.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Member_CannotBorrowForOthers_StaffCan()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batchief", "admin");
            var member = await LoginAsync(dbPath, "batxiaoli", "member");
            var battery = await CreateBatteryAsync(staff);

            // 取两个人的真实 id（BatteryLoans.UserId 有外键，不能随便编一个）
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            int memberId, staffId;
            await using (var db = new AppDbContext(opts))
            {
                memberId = await db.Users.Where(u => u.Username == "batxiaoli").Select(u => u.Id).FirstAsync();
                staffId = await db.Users.Where(u => u.Username == "batchief").Select(u => u.Id).FirstAsync();
            }

            // 普通成员不能替别人（这里用 staff 的 id）借
            var forbidden = await member.PostAsJsonAsync($"/api/battery/{battery.Id}/borrow", new { userId = staffId });
            Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

            // staff 代借
            var proxy = await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/borrow", new { userId = memberId, note = "代借" });
            Assert.Equal(HttpStatusCode.OK, proxy.StatusCode);
            var loan = (await proxy.Content.ReadFromJsonAsync<BorrowResp>())!;
            Assert.Equal(memberId, loan.BorrowerId);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task ByCode_IsCaseInsensitive_And_Overdue_Listed()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batcode", "admin");
            var battery = await CreateBatteryAsync(staff);

            var byCode = await staff.GetFromJsonAsync<BatteryResp>($"/api/battery/by-code/{battery.Code.ToLowerInvariant()}");
            Assert.NotNull(byCode);
            Assert.Equal(battery.Id, byCode!.Id);

            // 借出后把借出时间改到 25 小时前，触发默认 24 小时超时判定
            await staff.PostAsJsonAsync($"/api/battery/{battery.Id}/borrow", new { });
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var db = new AppDbContext(opts))
            {
                var loan = await db.BatteryLoans.FirstAsync(l => l.BatteryId == battery.Id);
                loan.BorrowedAt = DateTime.UtcNow.AddHours(-25);
                await db.SaveChangesAsync();
            }

            var overdue = await staff.GetFromJsonAsync<List<BorrowResp>>("/api/battery/overdue");
            Assert.NotNull(overdue);
            Assert.Single(overdue!);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Member_CannotEditBattery()
    {
        var dbPath = NewDbPath();
        try
        {
            var staff = await LoginAsync(dbPath, "batedit", "admin");
            var member = await LoginAsync(dbPath, "batviewer", "member");
            var battery = await CreateBatteryAsync(staff);

            var res = await member.PutAsJsonAsync($"/api/battery/{battery.Id}", new { status = "repair" });
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);

            var ok = await staff.PutAsJsonAsync($"/api/battery/{battery.Id}", new { status = "repair" });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
