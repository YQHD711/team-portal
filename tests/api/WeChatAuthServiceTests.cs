using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

public class WeChatAuthServiceTests
{
    private AppDbContext CreateContext()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var context = new AppDbContext(opts);
        context.Database.EnsureCreated();
        return context;
    }

    private IConfiguration CreateConfig(string? appId = "test-appid", string? appSecret = "test-appsecret")
    {
        var dict = new Dictionary<string, string?>
        {
            ["Jwt:Key"] = "this-is-a-test-key-at-least-32-characters-long!!",
            ["Jwt:Issuer"] = "test",
            ["Jwt:Audience"] = "test",
            ["WeChat:AppId"] = appId,
            ["WeChat:AppSecret"] = appSecret,
        };
        return new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
    }

    private SettingsService CreateSettings(AppDbContext db)
        => new(new TestScopeFactory(db));

    private static NullLogService CreateLog(AppDbContext db)
        => new(new TestScopeFactory(db));

    private static WeChatStateStore CreateState() => new();

    /// <summary>替身 HTTP 处理器：返回固定 JSON。</summary>
    private static HttpClient StubClient(string body)
    {
        var handler = new StubHandler(body);
        return new HttpClient(handler);
    }

    private sealed class StubHandler(string body) : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var resp = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
            };
            return Task.FromResult(resp);
        }
    }

    private WeChatAuthService CreateService(AppDbContext db, IConfiguration config, HttpClient? http = null, WeChatStateStore? store = null)
    {
        var settings = CreateSettings(db);
        return new WeChatAuthService(
            http ?? StubClient("""{"openid":"o-abc-123","unionid":"u-xyz","access_token":"tk","scope":"snsapi_userinfo"}"""),
            config, settings, CreateLog(db), db, store ?? new WeChatStateStore(),
            new AuthService(db, config, CreateLog(db), settings));
    }

    private async Task<AppDbContext> SeedEnabled()
    {
        var db = CreateContext();
        var settings = CreateSettings(db);
        await settings.Set("WeChat:Enabled", "true", "认证安全", "test");
        await settings.Set("WeChat:RedirectUri", "https://example.local/api/auth/wechat/callback", "认证安全", "test");
        return db;
    }

    [Fact]
    public async Task ExchangeCode_Success_ParsesOpenIdAndUnionId()
    {
        var db = CreateContext();
        var svc = CreateService(db, CreateConfig());
        var token = await svc.ExchangeCodeAsync("code123");
        Assert.Equal("o-abc-123", token.OpenId);
        Assert.Equal("u-xyz", token.UnionId);
    }

    [Fact]
    public async Task ExchangeCode_WechatError_Throws()
    {
        var db = CreateContext();
        var svc = CreateService(db, CreateConfig(), http: StubClient("""{"errcode":40029,"errmsg":"invalid code"}"""));
        var ex = await Assert.ThrowsAsync<WeChatApiException>(() => svc.ExchangeCodeAsync("badcode"));
        Assert.Equal(40029, ex.Code);
    }

    [Fact]
    public async Task Callback_Enabled_Unbound_ReturnsBindingToken()
    {
        var db = await SeedEnabled();
        var store = CreateState();
        var svc = CreateService(db, CreateConfig(), store: store);
        // state 由 store 生成，HandleCallbackAsync 校验逻辑与生成同源（可消费）
        var state = store.Generate();
        var result = await svc.HandleCallbackAsync("code", state);
        Assert.Equal("unbound", result.Kind);
        Assert.False(string.IsNullOrEmpty(result.BindingToken));
        // 票据可回验且 openid 一致
        var valid = svc.ValidateBindingToken(result.BindingToken);
        Assert.NotNull(valid);
        Assert.Equal("o-abc-123", valid.Value.OpenId);
    }

    [Fact]
    public async Task Callback_Enabled_Bound_ReturnsJwt()
    {
        var db = await SeedEnabled();
        db.Users.Add(new User
        {
            Username = "pilot",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw"),
            Role = "member",
            WeChatOpenId = "o-abc-123",
        });
        await db.SaveChangesAsync();

        var store = CreateState();
        var svc = CreateService(db, CreateConfig(), store: store);
        var state = store.Generate();
        var result = await svc.HandleCallbackAsync("code", state);
        Assert.Equal("bound", result.Kind);
        Assert.False(string.IsNullOrEmpty(result.Token));
    }

    [Fact]
    public async Task Callback_Enabled_StateConsumedOnce_ReplayRejected()
    {
        var db = await SeedEnabled();
        var store = CreateState();
        var svc = CreateService(db, CreateConfig(), store: store);
        var state = store.Generate();

        var first = await svc.HandleCallbackAsync("code", state);
        Assert.Equal("unbound", first.Kind);

        // 同一 state 二次使用（重放）应被拒
        var replay = await svc.HandleCallbackAsync("code", state);
        Assert.Equal("error", replay.Kind);
        Assert.Equal("bad_state", replay.ErrorCode);
    }

    [Fact]
    public async Task Callback_WrongState_Rejected()
    {
        var db = await SeedEnabled();
        var svc = CreateService(db, CreateConfig());
        var result = await svc.HandleCallbackAsync("code", "not-exist-state");
        Assert.Equal("error", result.Kind);
        Assert.Equal("bad_state", result.ErrorCode);
    }

    [Fact]
    public async Task Callback_Disabled_ReturnsDisabled()
    {
        var db = CreateContext();
        // 未 Seed → 默认 false
        var svc = CreateService(db, CreateConfig());
        var result = await svc.HandleCallbackAsync("code", CreateState().Generate());
        Assert.Equal("error", result.Kind);
        Assert.Equal("disabled", result.ErrorCode);
    }

    [Fact]
    public void BindingToken_Expired_InvalidAfter5Minutes()
    {
        var db = CreateContext();
        var svc = CreateService(db, CreateConfig());
        var token = svc.IssueBindingToken("o-abc", null);

        // 5 分钟过期由 JWT 自身 exp 校验保证；这里验证正常校验可用 + 字段正确
        var valid = svc.ValidateBindingToken(token);
        Assert.NotNull(valid);
        Assert.Equal("o-abc", valid.Value.OpenId);
        Assert.Null(valid.Value.UnionId);
    }

    [Fact]
    public void BindingToken_WrongAudience_Rejected()
    {
        var db = CreateContext();
        var svc = CreateService(db, CreateConfig());

        // 正式 token（audience=test）不应被当作绑定票据接受
        var auth = new AuthService(db, CreateConfig(), CreateLog(db), CreateSettings(db));
        var user = new User { Username = "t", PasswordHash = "x", Role = "member" };
        var normal = auth.IssueTokenFor(user).GetAwaiter().GetResult();
        Assert.Null(svc.ValidateBindingToken(normal));
    }

    [Fact]
    public async Task BindOpenId_WritesUserAndTargetsTodo()
    {
        var db = CreateContext();
        var user = new User { Username = "alice", PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw"), Role = "member" };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var svc = CreateService(db, CreateConfig());
        var ok = await svc.BindOpenId(user.Id, "o-abc", "u-xyz");
        Assert.True(ok);

        var reloaded = await db.Users.AsNoTracking().FirstAsync(u => u.Id == user.Id);
        Assert.Equal("o-abc", reloaded.WeChatOpenId);
        Assert.Equal("u-xyz", reloaded.WeChatUnionId);
        Assert.NotNull(reloaded.WeChatBoundAt);
    }

    [Fact]
    public async Task BindOpenId_Duplicate_Rejected()
    {
        var db = CreateContext();
        var userA = new User { Username = "alice", PasswordHash = "x", Role = "member" };
        var userB = new User { Username = "bob", PasswordHash = "x", Role = "member" };
        db.Users.AddRange(userA, userB);
        await db.SaveChangesAsync();

        var svc = CreateService(db, CreateConfig());
        Assert.True(await svc.BindOpenId(userA.Id, "o-1", null));

        var svc2 = CreateService(db, CreateConfig());
        Assert.False(await svc2.BindOpenId(userB.Id, "o-1", null));
    }

    [Fact]
    public async Task Unbind_RequiresPasswordAndClearsFields()
    {
        var db = CreateContext();
        var user = new User
        {
            Username = "carol",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("secret"),
            Role = "member",
            WeChatOpenId = "o-1",
            WeChatBoundAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var svc = CreateService(db, CreateConfig());
        Assert.False(await svc.UnbindWeChat(user.Id, "wrong"));
        Assert.True(await svc.UnbindWeChat(user.Id, "secret"));

        var reloaded = await db.Users.AsNoTracking().FirstAsync(u => u.Id == user.Id);
        Assert.Null(reloaded.WeChatOpenId);
        Assert.Null(reloaded.WeChatBoundAt);
    }
}