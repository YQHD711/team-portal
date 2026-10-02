using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 端到端确认「重新克隆」接口的权限与接线真的落在接口上（只测服务层会漏掉路由/鉴权那一层）。
/// 背景：工作区建在容器 /tmp，未挂卷 → 部署重建容器后源码浏览 404，
/// 项目页的「重新克隆」就是给用的恢复入口，必须只有 staff 能触发。
/// </summary>
public class WikiRecloneEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public WikiRecloneEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    private HttpClient NewClient(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>塞一个指定角色的用户 + 一条非 git/zip 的任务（真去克隆会真的跑 git，测试里不碰）。</summary>
    private async Task<HttpClient> LoginAsync(string dbPath, string username, string role)
    {
        var client = NewClient(dbPath);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User { Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"), Role = role });
            seed.WikiTasks.Add(new WikiTask { Id = "t-reclone", Type = "translate", ProjectName = "p", TargetFolder = "公共", Visibility = "public", Status = "failed" });
            await seed.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Reclone_RequiresAuthentication()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-reclone-{Guid.NewGuid():N}.db");
        try
        {
            var res = await NewClient(dbPath).PostAsJsonAsync("/api/wiki/tasks/t-reclone/reclone", new { });

            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode); // 401 而非 404：路由确实挂上了
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Reclone_MemberIsForbidden()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-reclone-{Guid.NewGuid():N}.db");
        try
        {
            var client = await LoginAsync(dbPath, "member1", "member");

            var res = await client.PostAsJsonAsync("/api/wiki/tasks/t-reclone/reclone", new { });

            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Reclone_AdminReachesService_AndUnknownTaskIs404()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-reclone-{Guid.NewGuid():N}.db");
        try
        {
            var client = await LoginAsync(dbPath, "admin1", "admin");

            var unknown = await client.PostAsJsonAsync("/api/wiki/tasks/nope/reclone", new { });
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

            // 只能克隆 git/zip 任务：translate 任务应被服务层挡下并给出原因（而不是去跑 git）
            var translate = await client.PostAsJsonAsync("/api/wiki/tasks/t-reclone/reclone", new { });
            Assert.Equal(HttpStatusCode.BadRequest, translate.StatusCode);
            Assert.Contains("只有 Git/ZIP 任务", await translate.Content.ReadAsStringAsync());
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
