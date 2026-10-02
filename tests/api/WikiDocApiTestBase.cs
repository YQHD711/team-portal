using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// Wiki 文档写接口测试的公共夹具：每个用例一个临时 SQLite 文件 + 临时知识库根目录，
/// 起真实宿主（含鉴权策略与路由），再塞一个指定角色的用户并登录。
/// 知识库根目录必须用临时目录，否则会写到真实 data/knowledge。
/// </summary>
public abstract class WikiDocApiTestBase : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    protected WikiDocApiTestBase(WebApplicationFactory<Program> factory) => _factory = factory;

    protected sealed record LoginResp(string Token);
    protected sealed record EditsResp(int Count, string[] Paths);
    protected sealed record NeedConfirmResp(string Detail, bool NeedConfirm, int ModifiedCount, string[] Paths);

    protected static string NewDbPath() => Path.Combine(Path.GetTempPath(), $"tp-doc-{Guid.NewGuid():N}.db");

    protected static string NewKbRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), $"tp-dockb-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }

    /// <summary>把某篇文档写进知识库（模拟"AI 已经生成过"）。</summary>
    protected static void SeedDoc(string kbRoot, string relative, string content = "# 原稿")
    {
        var full = Path.Combine(kbRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }

    protected static string ReadDoc(string kbRoot, string relative) =>
        File.ReadAllText(Path.Combine(kbRoot, relative.Replace('/', Path.DirectorySeparatorChar)));

    protected static WikiTask SeedTask(string id = "t-doc", string catalogJson = "[{\"path\":\"guide/intro\",\"title\":\"Intro\"}]") =>
        new()
        {
            Id = id, Type = "zip", SourceUrl = "archive::x", ProjectName = "proj",
            TargetFolder = "公共", Visibility = "public", Status = "completed", CatalogJson = catalogJson,
        };

    /// <summary>起宿主 → 塞用户（+可选的额外数据）→ 登录，返回已带 token 的 client。</summary>
    protected async Task<HttpClient> LoginAsync(string dbPath, string kbRoot, string username, string role,
        params WikiTask[] tasks)
    {
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Knowledge:BasePath", kbRoot);
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var db = new AppDbContext(opts))
        {
            db.Users.Add(new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = role,
            });
            await db.SaveChangesAsync();
            db.WikiTasks.AddRange(tasks);
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(System.Net.HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
