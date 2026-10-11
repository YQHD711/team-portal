using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-17 接口测试夹具：真实宿主（新库由 EF 迁移建 LabelTemplates，启动流程种下默认模板）+ 真实登录。
/// </summary>
public abstract class LabelTemplateEndpointTestBase : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    protected LabelTemplateEndpointTestBase(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);

    protected sealed record ListResp(List<LabelTemplateDto> Templates);
    protected sealed record DeleteResp(bool Ok, int? DefaultId);

    protected HttpClient NewClient(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    protected static string NewDbPath() => Path.Combine(Path.GetTempPath(), $"tp-label-{Guid.NewGuid():N}.db");

    protected async Task<HttpClient> LoginAsync(string dbPath, string username, string role)
    {
        var client = NewClient(dbPath);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User { Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"), Role = role });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    protected static async Task<List<LabelTemplateDto>> ListAsync(HttpClient client)
    {
        var res = await client.GetAsync("/api/label-templates");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<ListResp>())!.Templates;
    }
}
