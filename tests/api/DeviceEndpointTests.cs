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
/// 设备接入 API：管理员签发设备凭据，设备用 X-Device-Key/X-Device-Secret 调
/// /api/device/*；覆盖认证失败、禁用、重置密钥、遥测落库、按编码查物料、库存变动。
/// </summary>
public class DeviceEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public DeviceEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private sealed record LoginResp(string Token);
    private sealed record CreateDeviceResp(int Id, string Name, string DeviceKey, string? Type,
        string? LocationCode, bool Enabled, string Secret);
    private sealed record RotateResp(int Id, string Secret);
    private sealed record PingResp(int DeviceId, string Name, string? LocationCode);
    private sealed record TelemetryItem(int Id, int DeviceId, string Kind, string PayloadJson);

    private HttpClient NewClient(string dbPath)
    {
        // 预创建空库文件：SQLite 的 "unable to open database file" 在目录/路径异常时很难定位，
        // 先在这里显式落一个空文件，保证后续错误一定来自业务而不是环境。
        File.WriteAllBytes(dbPath, Array.Empty<byte>());

        return _factory.WithWebHostBuilder(b =>
        {
            // 必须用 UseSetting：Program.cs 顶层在 app.Build() 之前就读 Jwt:Key，
            // ConfigureAppConfiguration 的委托要到 host 构建时才执行，会读到空值随机生成密钥，
            // 导致"登录成功、带 token 的请求 401"。
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            // 测试宿主在 Windows 上默认挂 EventLog provider，当前用户无事件日志写权限会直接抛异常；
            // 集成测试不需要日志输出，清掉全部 provider。
            b.ConfigureLogging(lb => lb.ClearProviders());
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private static string NewDbPath() => Path.Combine(Directory.GetCurrentDirectory(), $"tp-dev-{Guid.NewGuid():N}.db");

    private async Task<HttpClient> AdminClientAsync(string dbPath)
    {
        var client = NewClient(dbPath);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Users.Add(new User
            {
                Username = "admin-dev",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                Role = "admin",
            });
            await seed.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin-dev", password = "pw123456" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static void UseDevice(HttpClient client, string deviceKey, string secret)
    {
        client.DefaultRequestHeaders.Remove("X-Device-Key");
        client.DefaultRequestHeaders.Remove("X-Device-Secret");
        client.DefaultRequestHeaders.Add("X-Device-Key", deviceKey);
        client.DefaultRequestHeaders.Add("X-Device-Secret", secret);
    }

    private static async Task<CreateDeviceResp> CreateDeviceAsync(HttpClient admin, string name, string? locationCode = null)
    {
        var res = await admin.PostAsJsonAsync("/api/admin/devices",
            new { name, type = "esp32", locationCode });
        if (res.StatusCode != HttpStatusCode.Created)
            Assert.Fail($"{(int)res.StatusCode} {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<CreateDeviceResp>())!;
    }

    [Fact]
    public async Task CreateDevice_ReturnsSecret_AndPingAuthenticates()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "柜1采集器", "CAB-01");

            Assert.StartsWith("dev_", created.DeviceKey);
            Assert.Equal(48, created.Secret.Length);
            Assert.True(created.Enabled);

            UseDevice(client, created.DeviceKey, created.Secret);
            var ping = await client.GetAsync("/api/device/ping");
            Assert.Equal(HttpStatusCode.OK, ping.StatusCode);
            var body = (await ping.Content.ReadFromJsonAsync<PingResp>())!;
            Assert.Equal(created.Id, body.DeviceId);
            Assert.Equal("柜1采集器", body.Name);
            Assert.Equal("CAB-01", body.LocationCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Ping_WrongSecret_Returns401()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "柜2");

            UseDevice(client, created.DeviceKey, new string('0', 48));
            var ping = await client.GetAsync("/api/device/ping");
            Assert.Equal(HttpStatusCode.Unauthorized, ping.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task DisabledDevice_Returns401()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "柜3");

            var disable = await client.PutAsJsonAsync($"/api/admin/devices/{created.Id}", new { enabled = false });
            Assert.Equal(HttpStatusCode.OK, disable.StatusCode);

            UseDevice(client, created.DeviceKey, created.Secret);
            var ping = await client.GetAsync("/api/device/ping");
            Assert.Equal(HttpStatusCode.Unauthorized, ping.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task RotateSecret_OldSecretStopsWorking()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "柜4");

            var rotate = await client.PostAsync($"/api/admin/devices/{created.Id}/rotate-secret", null);
            Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
            var fresh = (await rotate.Content.ReadFromJsonAsync<RotateResp>())!;
            Assert.NotEqual(created.Secret, fresh.Secret);

            UseDevice(client, created.DeviceKey, created.Secret);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/device/ping")).StatusCode);

            UseDevice(client, created.DeviceKey, fresh.Secret);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/device/ping")).StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Telemetry_IsPersisted_AndVisibleToAdmin()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "称重节点");

            UseDevice(client, created.DeviceKey, created.Secret);
            var post = await client.PostAsJsonAsync("/api/device/telemetry",
                new { kind = "weight", payload = new { cabinet = "CAB-01", grams = 12345 } });
            Assert.Equal(HttpStatusCode.Created, post.StatusCode);

            var list = await client.GetFromJsonAsync<List<TelemetryItem>>(
                $"/api/admin/devices/{created.Id}/telemetry");
            Assert.NotNull(list);
            Assert.Single(list!);
            Assert.Equal("weight", list[0].Kind);
            Assert.Contains("12345", list[0].PayloadJson);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Telemetry_Rejects_OversizedPayload()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "大包测试");

            UseDevice(client, created.DeviceKey, created.Secret);
            var big = new string('x', 25000);
            var post = await client.PostAsJsonAsync("/api/device/telemetry",
                new { kind = "x", payload = new { blob = big } });
            Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Material_GetByCode_And_StockDelta()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "扫码枪");

            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var seed = new AppDbContext(opts))
            {
                seed.InventoryItems.Add(new InventoryItem
                {
                    Name = "6S 电池", Category = "电池电源", Quantity = 10,
                    Code = "BAT-TEST-2026-0001", Status = "available",
                });
                await seed.SaveChangesAsync();
            }

            UseDevice(client, created.DeviceKey, created.Secret);
            var get = await client.GetAsync("/api/device/materials/BAT-TEST-2026-0001");
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);

            var stock = await client.PostAsJsonAsync("/api/device/materials/BAT-TEST-2026-0001/stock",
                new { delta = -2, note = "拿出去飞" });
            Assert.Equal(HttpStatusCode.OK, stock.StatusCode);

            var again = await client.GetAsync("/api/device/materials/BAT-TEST-2026-0001");
            var payload = await again.Content.ReadFromJsonAsync<Dictionary<string, object>>();
            Assert.Equal("8", payload!["quantity"].ToString());
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task AdminList_MarksRecentlySeenDeviceOnline()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await AdminClientAsync(dbPath);
            var created = await CreateDeviceAsync(client, "在线检测");

            UseDevice(client, created.DeviceKey, created.Secret);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/device/ping")).StatusCode);

            var list = await client.GetFromJsonAsync<List<Dictionary<string, object>>>("/api/admin/devices");
            Assert.NotNull(list);
            var row = Assert.Single(list!);
            Assert.Equal("True", row["online"].ToString());
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
