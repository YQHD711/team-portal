using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 微信公众号网页授权登录核心逻辑：
/// 授权链接 / code 换 openid / 绑定票据签发与校验 / 绑定与解绑。
/// AppId 来自配置 WeChat:AppId；AppSecret 仅来自 WeChat:AppSecret（环境变量，禁存 DB）。
/// </summary>
public class WeChatAuthService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly SettingsService _settings;
    private readonly LogService _log;
    private readonly AppDbContext _db;
    private readonly WeChatStateStore _stateStore;
    private readonly AuthService _auth;

    public WeChatAuthService(
        HttpClient http, IConfiguration config, SettingsService settings, LogService log,
        AppDbContext db, WeChatStateStore stateStore, AuthService auth)
    {
        _http = http; _config = config; _settings = settings; _log = log;
        _db = db; _stateStore = stateStore; _auth = auth;
    }

    private const string TokenAudience = "wechat-bind";

    public async Task<bool> IsEnabledAsync() => await _settings.GetBool("WeChat:Enabled", false);

    public string AppId => _config["WeChat:AppId"] ?? "";
    private string AppSecret => _config["WeChat:AppSecret"] ?? "";

    private string AuthCodeUrl => "https://open.weixin.qq.com/connect/oauth2/authorize";
    private string AccessTokenUrl => "https://api.weixin.qq.com/sns/oauth2/access_token";

    /// <summary>构造网页授权链接（scope=snsapi_userinfo，带一次性 state）。</summary>
    public async Task<string?> BuildAuthorizeUrlAsync()
    {
        if (!await IsEnabledAsync()) return null;
        var appId = AppId;
        var redirectUri = await _settings.Get("WeChat:RedirectUri");
        if (string.IsNullOrWhiteSpace(appId) || string.IsNullOrWhiteSpace(redirectUri)) return null;
        var state = _stateStore.Generate();
        return $"{AuthCodeUrl}?appid={Uri.EscapeDataString(appId)}" +
               $"&redirect_uri={Uri.EscapeDataString(redirectUri)}" +
               "&response_type=code&scope=snsapi_userinfo" +
               $"&state={Uri.EscapeDataString(state)}#wechat_redirect";
    }

    /// <summary>用 code 换 access_token/openid/unionid。微信侧返回 errcode 时抛 WeChatApiException。</summary>
    public async Task<WeChatToken> ExchangeCodeAsync(string code)
    {
        var appId = AppId;
        var appSecret = AppSecret;
        if (string.IsNullOrWhiteSpace(appId) || string.IsNullOrWhiteSpace(appSecret))
            throw new WeChatApiException("微信 AppId/AppSecret 未配置", -1);

        var url = $"{AccessTokenUrl}?appid={Uri.EscapeDataString(appId)}" +
                  $"&secret={Uri.EscapeDataString(appSecret)}" +
                  $"&code={Uri.EscapeDataString(code)}&grant_type=authorization_code";
        var json = await _http.GetStringAsync(url);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.TryGetProperty("errcode", out var err))
        {
            var msg = root.TryGetProperty("errmsg", out var m) ? m.GetString() : null;
            throw new WeChatApiException(msg ?? "微信接口返回错误", err.GetInt32());
        }
        return new WeChatToken(
            OpenId: root.GetProperty("openid").GetString() ?? "",
            UnionId: root.TryGetProperty("unionid", out var u) ? u.GetString() : null);
    }

    /// <summary>签发绑定票据 JWT：5 分钟过期、audience 隔离（正式 Bearer 校验不接受）。</summary>
    public string IssueBindingToken(string openId, string? unionId)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim("purpose", "wechat_bind"),
            new Claim("openid", openId),
            new Claim("unionid", unionId ?? ""),
        };
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: TokenAudience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>校验绑定票据，返回 (openId, unionId)；无效/过期返回 null。</summary>
    public (string OpenId, string? UnionId)? ValidateBindingToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            var handler = new JwtSecurityTokenHandler();
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
            var principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = _config["Jwt:Issuer"],
                ValidateAudience = true,
                ValidAudience = TokenAudience,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ClockSkew = TimeSpan.FromSeconds(30),
            }, out _);
            if (principal.FindFirst("purpose")?.Value != "wechat_bind") return null;
            var openId = principal.FindFirst("openid")?.Value;
            if (string.IsNullOrWhiteSpace(openId)) return null;
            var unionId = principal.FindFirst("unionid")?.Value;
            return (openId, string.IsNullOrWhiteSpace(unionId) ? null : unionId);
        }
        catch (SecurityTokenException)
        {
            return null;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>将 openid 绑定到指定用户（DB 唯一索引兜底并发冲突）。</summary>
    public async Task<bool> BindOpenId(int userId, string openId, string? unionId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return false;
        if (!string.IsNullOrEmpty(user.WeChatOpenId)) return false; // 已绑定过
        user.WeChatOpenId = openId;
        user.WeChatUnionId = unionId;
        user.WeChatBoundAt = DateTime.UtcNow;
        try
        {
            await _db.SaveChangesAsync();
            return true;
        }
        catch (DbUpdateException)
        {
            // openid 已被其他用户绑定 → 唯一索引冲突
            return false;
        }
    }

    /// <summary>解绑：校验当前密码后清空微信绑定字段。</summary>
    public async Task<bool> UnbindWeChat(int userId, string password)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null || string.IsNullOrEmpty(user.WeChatOpenId)) return false;
        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash)) return false;
        user.WeChatOpenId = null;
        user.WeChatUnionId = null;
        user.WeChatBoundAt = null;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>微信回调核心：开关 → state 校验 → code 换 openid → 查绑定。</summary>
    public async Task<WeChatCallbackResult> HandleCallbackAsync(string code, string state)
    {
        if (!await IsEnabledAsync())
            return new WeChatCallbackResult("error", ErrorCode: "disabled");
        if (!_stateStore.ValidateAndConsume(state))
            return new WeChatCallbackResult("error", ErrorCode: "bad_state");
        if (string.IsNullOrWhiteSpace(code))
            return new WeChatCallbackResult("error", ErrorCode: "missing_code");

        WeChatToken token;
        try
        {
            token = await ExchangeCodeAsync(code);
        }
        catch (WeChatApiException ex)
        {
            _log.Warn("wechat", $"微信 code 换取 openid 失败: {ex.Code} {ex.Message}");
            return new WeChatCallbackResult("error", ErrorCode: "exchange_failed");
        }

        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.WeChatOpenId == token.OpenId);
        if (user is not null)
        {
            _log.Info("wechat", $"微信登录成功: {user.Username} (openid 命中绑定)");
            var jwt = await _auth.IssueTokenFor(user);
            return new WeChatCallbackResult("bound", Token: jwt, OpenId: token.OpenId);
        }

        var binding = IssueBindingToken(token.OpenId, token.UnionId);
        return new WeChatCallbackResult("unbound", BindingToken: binding, OpenId: token.OpenId);
    }
}

public record WeChatToken(string OpenId, string? UnionId);

/// <summary>回调处理结果。Kind ∈ bound / unbound / error。</summary>
public record WeChatCallbackResult(string Kind, string? Token = null, string? BindingToken = null, string? OpenId = null, string? ErrorCode = null);

public class WeChatApiException : Exception
{
    public int Code { get; }
    public WeChatApiException(string message, int code) : base(message) => Code = code;
}
