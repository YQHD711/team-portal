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

/// <summary>显示姓名落地：日志查询响应带 displayName（展示用显示姓名，审计留登录名快照）。</summary>
public class DisplayNameUsageTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public DisplayNameUsageTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record OpItem(int Id, string UserName, string? DisplayName);

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-dn-{Guid.NewGuid():N}.db");

    private HttpClient NewClient(string dbPath)
    {
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

    [Fact]
    public async Task Operations_ReturnsDisplayName()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = NewClient(dbPath);
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var seed = new AppDbContext(opts))
            {
                seed.Users.Add(new User
                {
                    Username = "zhangsan",
                    DisplayName = "张三",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                    Role = "admin",
                });
                await seed.SaveChangesAsync();
            }

            var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "zhangsan", password = "pw123456" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token);

            // 登录写了一条审计（audit 通道异步落库，轮询到出现为止）
            List<OpItem>? items = null;
            for (var i = 0; i < 20 && (items is null || items.Count == 0); i++)
            {
                await Task.Delay(300);
                var resp = await client.GetFromJsonAsync<Dictionary<string, object>>("/api/admin/logs/operations?size=10");
                items = System.Text.Json.JsonSerializer.Deserialize<List<OpItem>>(
                    System.Text.Json.JsonSerializer.Serialize(resp!["items"]),
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            }

            Assert.NotNull(items);
            var json = System.Text.Json.JsonSerializer.Serialize(items);
            Assert.True(items!.Count > 0, "审计日志为空（登录审计未落库）");
            Assert.True(items!.Any(o => o.UserName == "zhangsan" && o.DisplayName == "张三"),
                "实际日志: " + json);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
