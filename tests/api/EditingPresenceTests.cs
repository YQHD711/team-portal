using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 「谁正在编辑房间」在线状态：心跳可见、**过期自动消失**（否则会出现幽灵编辑者）、
/// 离开/保存后立刻清除。服务层用注入时间做确定性验证，端点层用短 TTL 走真实 HTTP。
/// </summary>
public class EditingPresenceTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public EditingPresenceTests(WebApplicationFactory<Program> factory) => _factory = factory;

    // ── 服务层：TTL 语义（不依赖真实时间流逝）──────────────────────────

    [Fact]
    public void Heartbeat_MakesEditorVisible()
    {
        var svc = new EditingPresenceService(TimeSpan.FromSeconds(30));
        var now = new DateTime(2026, 10, 16, 10, 0, 0, DateTimeKind.Utc);

        var editors = svc.Heartbeat(roomId: 7, userId: 1, name: "小王", nowUtc: now);

        var only = Assert.Single(editors);
        Assert.Equal("小王", only.Name);
        Assert.Equal(now.AddSeconds(30), only.ExpiresAtUtc);
    }

    [Fact]
    public void ExpiredHeartbeat_Disappears_NoGhostEditor()
    {
        var svc = new EditingPresenceService(TimeSpan.FromSeconds(30));
        var now = new DateTime(2026, 10, 16, 10, 0, 0, DateTimeKind.Utc);
        svc.Heartbeat(7, 1, "小王", now);

        Assert.Empty(svc.Editors(7, now.AddSeconds(31)));
        // 再查一次仍是空（过期条目已被真正删除，而不是每次过滤）
        Assert.Empty(svc.Editors(7, now.AddSeconds(90)));
    }

    [Fact]
    public void Leave_ClearsImmediately_WithoutWaitingForTtl()
    {
        var svc = new EditingPresenceService(TimeSpan.FromSeconds(30));
        var now = new DateTime(2026, 10, 16, 10, 0, 0, DateTimeKind.Utc);
        svc.Heartbeat(7, 1, "小王", now);
        svc.Heartbeat(7, 2, "小李", now);

        Assert.True(svc.Leave(7, 1));

        var remaining = Assert.Single(svc.Editors(7, now.AddSeconds(5)));
        Assert.Equal("小李", remaining.Name);
    }

    [Fact]
    public void RepeatHeartbeat_KeepsOriginalSince_AndRefreshesExpiry()
    {
        var svc = new EditingPresenceService(TimeSpan.FromSeconds(30));
        var now = new DateTime(2026, 10, 16, 10, 0, 0, DateTimeKind.Utc);
        svc.Heartbeat(7, 1, "小王", now);
        var again = svc.Heartbeat(7, 1, "小王", now.AddSeconds(10));

        var only = Assert.Single(again);
        Assert.Equal(now, only.SinceUtc);                          // 进入时间不变
        Assert.Equal(now.AddSeconds(40), only.ExpiresAtUtc);       // 过期时间顺延
    }

    // ── 端点层：真实 HTTP + 短 TTL ─────────────────────────────────

    private sealed record LoginResp(string Token);

    [Fact]
    public async Task Endpoints_HeartbeatThenPollThenLeave_AndTtlExpiry()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-presence-{Guid.NewGuid():N}.db");
        var factory = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", TestToken.JwtKey);
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            // 覆盖单例：TTL 缩到 1 秒，才能在测试里观察到"幽灵自动消失"
            b.ConfigureTestServices(s => s.AddSingleton(new EditingPresenceService(TimeSpan.FromSeconds(1))));
        });
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using (var seed = new AppDbContext(opts))
        {
            seed.Database.Migrate();
            seed.Users.Add(new User { Id = 1, Username = "editor", PasswordHash = "x", Role = "admin" });
            await seed.SaveChangesAsync();
        }

        // 不调登录接口（限流 5 次/60 秒/IP，会让并行测试互相打成 429），直接签发 token
        client.DefaultRequestHeaders.Authorization = new("Bearer", TestToken.Make(1, "editor", "admin"));

        var created = await client.PostAsJsonAsync("/api/storage/layouts", new
        {
            roomCode = "1096", roomName = "在线状态房", floor = 1, cabinetCount = 1, shelfCount = 1, positionCount = 1
        });
        var layout = await created.Content.ReadFromJsonAsync<StorageLayout>();

        // 无人时：返回空数组（前端据此"什么都不显示"）
        var empty = await client.GetFromJsonAsync<PresencePayload>($"/api/storage/layouts/{layout!.Id}/editing");
        Assert.Empty(empty!.Editors);

        // 心跳后可见
        var beat = await client.PostAsync($"/api/storage/layouts/{layout.Id}/editing", null);
        Assert.Equal(HttpStatusCode.OK, beat.StatusCode);
        var afterBeat = await client.GetFromJsonAsync<PresencePayload>($"/api/storage/layouts/{layout.Id}/editing");
        Assert.Single(afterBeat!.Editors);
        Assert.Equal("editor", afterBeat.Editors[0].Name);

        // TTL 过期 → 自动消失（不是永远挂着）
        await Task.Delay(1500);
        var expired = await client.GetFromJsonAsync<PresencePayload>($"/api/storage/layouts/{layout.Id}/editing");
        Assert.Empty(expired!.Editors);

        // 心跳 + 立刻离开 → 马上清掉，不用等 TTL
        await client.PostAsync($"/api/storage/layouts/{layout.Id}/editing", null);
        await client.DeleteAsync($"/api/storage/layouts/{layout.Id}/editing");
        var afterLeave = await client.GetFromJsonAsync<PresencePayload>($"/api/storage/layouts/{layout.Id}/editing");
        Assert.Empty(afterLeave!.Editors);
        _ = dbPath;
    }

    private sealed record EditorDto(int UserId, string Name);
    private sealed record PresencePayload(List<EditorDto> Editors, int TtlSeconds);
}
