using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// task-14 A 的接口层：`GET /api/ai/suggestions`。
/// 只测服务层会漏掉路由/鉴权，这里钉住契约（401 / 200 + { suggestions:[{text,kind}] }）与
/// "普通队员也能拿到库存题"（物料与布局全员可见）。
/// </summary>
public class AiSuggestionEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AiSuggestionEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record SuggestionDto(string Text, string Kind);
    private sealed record SuggestResp(List<SuggestionDto> Suggestions);

    private HttpClient NewClient(string dbPath, string kbDir) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        b.UseSetting("Knowledge:BasePath", kbDir);
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static string NewKbDir()
    {
        var kb = Path.Combine(Path.GetTempPath(), $"tp-suggest-ep-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(kb, "公共", "参考资料"));
        Directory.CreateDirectory(Path.Combine(kb, "工程部"));
        File.WriteAllText(Path.Combine(kb, "公共", "参考资料", "物料管理规范.md"),
            "# 物料管理规范\n\n## 领用与归还\n\nB 级物料需部长审批。\n\n## 入库验收\n\n数量与编码要核对。\n");
        File.WriteAllText(Path.Combine(kb, "工程部", "工程部安全须知.md"), "# 工程部安全须知\n\n## 试飞安全\n\n跑道两侧禁止站人。\n");
        return kb;
    }

    private async Task<HttpClient> LoginAsync(string dbPath, string kbDir, string username)
    {
        var client = NewClient(dbPath, kbDir);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = "member",
            });
            seed.InventoryItems.AddRange(
                new InventoryItem { Name = "碳纤维管", Code = "EL-CFRP-2026-0001", Category = "结构件", Quantity = 7, LocationCode = "1030-A-1-01", Grade = "B" },
                new InventoryItem { Name = "无刷电机", Code = "EL-MOTOR-2026-0002", Category = "动力", Quantity = 3, LocationCode = "1030-A-2-01", Grade = "B" },
                new InventoryItem { Name = "锂电池", Code = "EL-LIPO-2026-0003", Category = "动力", Quantity = 12, LocationCode = "1030-A-3-01", Grade = "B" });
            await seed.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Suggestions_RequireAuthentication()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-suggest-ep-{Guid.NewGuid():N}.db");
        try
        {
            var res = await NewClient(dbPath, NewKbDir()).GetAsync("/api/ai/suggestions");
            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);   // 401 而非 404：路由确实挂上了
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Suggestions_MemberGetsRealQuestions_IncludingInventory()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-suggest-ep-{Guid.NewGuid():N}.db");
        var kbDir = NewKbDir();
        try
        {
            var client = await LoginAsync(dbPath, kbDir, "sugmember");

            var res = await client.GetAsync("/api/ai/suggestions");
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var body = await res.Content.ReadFromJsonAsync<SuggestResp>();

            Assert.NotNull(body);
            Assert.InRange(body!.Suggestions.Count, 1, 4);
            Assert.All(body.Suggestions, s =>
            {
                Assert.False(string.IsNullOrWhiteSpace(s.Text));
                Assert.Contains(s.Kind, new[] { "doc", "study", "inventory" });
            });
            // 库存题来自程序启动时种子化的 6 个房间 + 刚塞的 3 件物料（普通队员同样可见）
            Assert.Contains(body.Suggestions, s => s.Kind == "inventory" && s.Text.Contains("库房") && s.Text.Contains("货架分布"));
            Assert.Contains(body.Suggestions, s => s.Kind == "inventory" && s.Text.Contains("还剩多少"));
            // 文档题来自这台"服务器"上真实存在的知识库文档
            Assert.Contains(body.Suggestions, s => s.Kind == "doc" && s.Text.Contains("物料管理规范"));
            // ACL：这个队员没有部门，看不到工程部的文档
            Assert.DoesNotContain(body.Suggestions, s => s.Text.Contains("工程部"));
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
            try { Directory.Delete(kbDir, true); } catch { }
        }
    }
}
