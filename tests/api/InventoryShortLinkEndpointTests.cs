using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 短链对外地址必须来自"配置"或"调用方给的 origin"，**绝不能是后端自己看到的 Host**。
///
/// 回归的原始缺陷：后端收到的是 Next.js 服务端转发的请求，ctx.Request.Host 是容器内网
/// 地址，于是真的生成出过 `http://backend:8080/i/XX-...` 这种谁也扫不开的短链。
/// 当时服务层的单测全绿 —— 因为漏的正是"接口到底拿哪个地址去拼"这一层，所以这条
/// 特意走完整的 HTTP 管线来锁。
/// </summary>
public class InventoryShortLinkEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public InventoryShortLinkEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record MetaResp(string? PublicBaseUrl, bool PublicBaseLooksLocal);

    private async Task<HttpClient> AuthedClientAsync(string dbPath)
    {
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = "metauser",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = "member",
            });
            await seed.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "metauser", password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Meta_UsesCallerOrigin_NotTheHostBackendSees()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-meta-{Guid.NewGuid():N}.db");
        try
        {
            var client = await AuthedClientAsync(dbPath);

            // 测试宿主的 Host 是 localhost —— 如果接口拿它来拼，这里就会是 localhost 而不是我们传的地址
            var res = await client.GetFromJsonAsync<MetaResp>(
                "/api/inventory/meta?origin=" + Uri.EscapeDataString("http://8.137.161.160:3000"));

            Assert.NotNull(res);
            Assert.Equal("http://8.137.161.160:3000", res!.PublicBaseUrl);
            Assert.False(res.PublicBaseLooksLocal);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Meta_FlagsSingleLabelHostAsNonPublic()
    {
        // 容器服务名（backend / web）没有点，手机在公网 DNS 上解析不了 —— 必须报警
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-meta-{Guid.NewGuid():N}.db");
        try
        {
            var client = await AuthedClientAsync(dbPath);

            var res = await client.GetFromJsonAsync<MetaResp>(
                "/api/inventory/meta?origin=" + Uri.EscapeDataString("http://backend:8080"));

            Assert.NotNull(res);
            Assert.Equal("http://backend:8080", res!.PublicBaseUrl);
            Assert.True(res.PublicBaseLooksLocal);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Meta_NoOriginNoConfig_ReturnsEmpty_NotTheInternalHost()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-meta-{Guid.NewGuid():N}.db");
        try
        {
            var client = await AuthedClientAsync(dbPath);

            var res = await client.GetFromJsonAsync<MetaResp>("/api/inventory/meta");

            Assert.NotNull(res);
            // 宁可空着让前端自己兜底，也不能回一个内网地址
            Assert.Equal("", res!.PublicBaseUrl);
            Assert.True(res.PublicBaseLooksLocal);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task QrSvg_WithoutAnyUsableBase_RefusesInsteadOfEncodingAnInternalAddress()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-meta-{Guid.NewGuid():N}.db");
        try
        {
            var client = await AuthedClientAsync(dbPath);

            var res = await client.GetAsync("/api/inventory/by-code/BAT-TEST/qr.svg");

            // 409 而不是 200：宁可不给二维码，也不给一个扫不开的
            Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task QrSvg_WithOrigin_ReturnsSvgBuiltFromThatOrigin()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-meta-{Guid.NewGuid():N}.db");
        try
        {
            var client = await AuthedClientAsync(dbPath);

            var res = await client.GetAsync(
                "/api/inventory/by-code/BAT-TEST/qr.svg?origin=" + Uri.EscapeDataString("http://8.137.161.160:3000"));

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("image/svg+xml", res.Content.Headers.ContentType?.MediaType);
            var svg = await res.Content.ReadAsStringAsync();
            Assert.StartsWith("<svg", svg.TrimStart());
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
