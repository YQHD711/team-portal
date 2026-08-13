using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// Baidu Netdisk (百度网盘) integration for large file cloud storage.
/// Uses OAuth 2.0 with client credentials flow.
/// </summary>
/// <remarks>
/// 主类部分：字段、OAuth 授权流程（授权链接/兑换令牌/令牌刷新）。
/// 其余职责拆分为 partial：Upload（分块上传）、Files（下载/列表/删除/配额/建目录）、Backup（系统备份）。
/// </remarks>
public partial class BaiduNetdiskService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly SettingsService _settings;
    private readonly LogService _log;
    private static string? _accessToken;
    private static DateTime _tokenExpiry = DateTime.MinValue;
    private static readonly SemaphoreSlim _tokenSemaphore = new(1, 1);

    private const string OAuthUrl = "https://openapi.baidu.com/oauth/2.0/token";
    private const string AuthUrl = "https://openapi.baidu.com/oauth/2.0/authorize";
    private const string DeviceAuthUrl = "https://openapi.baidu.com/oauth/2.0/device/code";
    private const string ApiBase = "https://pan.baidu.com/rest/2.0/xpan";
    private const string UploadBase = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
    private const string RedirectUri = "oob";

    /// <summary>系统在百度网盘中的根目录（百度开放平台要求 /apps/ 前缀）</summary>
    public const string RootDir = "/apps/team-portal";
    /// <summary>用户上传文件的默认目录</summary>
    public const string DefaultUploadDir = RootDir + "/user-data/documents";

    private static string TokenFile => Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "baidu-token.json"));

    /// <summary>Read HTTP response as UTF-8 string, bypassing charset header parsing issues (Baidu server sends "utf8" not "utf-8").</summary>
    private static async Task<string> ReadBodyAsync(HttpContent content)
    {
        var bytes = await content.ReadAsByteArrayAsync();
        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>
    /// Check Baidu API response for errno != 0. Returns true if no error.
    /// On auth errors (6, 111, -6), resets cached token for re-auth.
    /// </summary>
    private bool CheckBaiduError(JsonElement root, string operation, string rawBody)
    {
        if (!root.TryGetProperty("errno", out var errno) || errno.GetInt32() == 0)
            return true;

        var code = errno.GetInt32();
        if (code == 6 || code == 111 || code == -6)
        {
            _accessToken = null;
            _tokenExpiry = DateTime.MinValue;
            _log.Warn("baidu", $"[{operation}] Token expired (errno={code}), reset for re-auth");
        }

        _log.Error("baidu", $"[{operation}] API error errno={code}: {rawBody[..Math.Min(300, rawBody.Length)]}");
        return false;
    }

    public BaiduNetdiskService(HttpClient http, IConfiguration config, LogService log, SettingsService settings)
    {
        _http = http;
        _config = config;
        _log = log;
        _settings = settings;
    }

    private async Task<string> GetAppKey() => await _settings.Get("Baidu:AppKey") is { Length: > 0 } k ? k : (_config.GetValue<string>("Baidu:AppKey") ?? "");
    private async Task<string> GetSecretKey() => await _settings.Get("Baidu:SecretKey") is { Length: > 0 } k ? k : (_config.GetValue<string>("Baidu:SecretKey") ?? "");

    public async Task<bool> IsConfigured()
    {
        var appKey = await GetAppKey();
        var secretKey = await GetSecretKey();
        return !string.IsNullOrEmpty(appKey) && !string.IsNullOrEmpty(secretKey);
    }

    /// <summary>
    /// Get the Baidu OAuth authorization URL. Admin must visit this once to grant access.
    /// </summary>
    public async Task<string> GetAuthUrl()
    {
        var appKey = await GetAppKey();
        var redirectUri = RedirectUri;
        return $"{AuthUrl}?response_type=code&client_id={appKey}&redirect_uri={Uri.EscapeDataString(redirectUri)}&scope=basic,netdisk&display=page&force_login=1";
    }

    public async Task<string> ExchangeCode(string code)
    {
        var appKey = await GetAppKey();
        var secretKey = await GetSecretKey();
        var redirectUri = RedirectUri;
        var url = $"{OAuthUrl}?grant_type=authorization_code&code={code}&client_id={appKey}&client_secret={secretKey}&redirect_uri={Uri.EscapeDataString(redirectUri)}";
        _log.Info("baidu", $"Exchanging code for token...");

        var resp = await _http.GetAsync(url);
        var body = await ReadBodyAsync(resp.Content);
        _log.Info("baidu", $"Exchange response: {body[..Math.Min(300, body.Length)]}");

        if (!body.TrimStart().StartsWith('{'))
            throw new InvalidOperationException($"授权失败，返回非JSON: {body[..Math.Min(200, body.Length)]}");

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("error", out var err))
        {
            var desc = doc.RootElement.TryGetProperty("error_description", out var d) ? d.GetString() : "";
            throw new InvalidOperationException($"授权错误: {err.GetString()} - {desc}");
        }

        _accessToken = doc.RootElement.GetProperty("access_token").GetString()!;
        var refreshToken = doc.RootElement.GetProperty("refresh_token").GetString()!;
        var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();
        _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 300);

        File.WriteAllText(TokenFile, JsonSerializer.Serialize(new { refresh_token = refreshToken }));
        _log.Info("baidu", $"Netdisk authorized. Token expires in {expiresIn}s, refresh_token stored");
        return "授权成功！网盘功能已可用";
    }

    private async Task<string> GetAccessToken()
    {
        await _tokenSemaphore.WaitAsync();
        try
        {
            if (!string.IsNullOrEmpty(_accessToken) && DateTime.UtcNow < _tokenExpiry)
                return _accessToken;

            var appKey = await GetAppKey();
            var secretKey = await GetSecretKey();

            // Try refresh token first
            if (File.Exists(TokenFile))
            {
                var saved = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(TokenFile));
                if (saved.TryGetProperty("refresh_token", out var rt) && rt.GetString() is { Length: > 0 } refreshToken)
                {
                    var refreshUrl = $"{OAuthUrl}?grant_type=refresh_token&refresh_token={refreshToken}&client_id={appKey}&client_secret={secretKey}";
                    var resp = await _http.GetAsync(refreshUrl);
                    var body = await ReadBodyAsync(resp.Content);

                    if (body.TrimStart().StartsWith('{'))
                    {
                        using var doc = JsonDocument.Parse(body);
                        if (!doc.RootElement.TryGetProperty("error", out _))
                        {
                            _accessToken = doc.RootElement.GetProperty("access_token").GetString()!;
                            var newRefresh = doc.RootElement.GetProperty("refresh_token").GetString()!;
                            var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();
                            _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 300);
                            File.WriteAllText(TokenFile, JsonSerializer.Serialize(new { refresh_token = newRefresh }));
                            _log.Info("baidu", $"Token refreshed, expires in {expiresIn}s");
                            return _accessToken;
                        }
                    }

                    _log.Warn("baidu", $"Token refresh failed: {body[..Math.Min(200, body.Length)]}");
                }
            }

            throw new InvalidOperationException("百度网盘未授权或Token已过期，请先访问 /api/admin/baidu/auth-url 重新授权");
        }
        finally
        {
            _tokenSemaphore.Release();
        }
    }
}

public class BaiduFile
{
    [System.Text.Json.Serialization.JsonPropertyName("fsId")]
    public long FsId { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("path")]
    public string Path { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string FileName { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("size")]
    public long Size { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("isDir")]
    public bool IsDir { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("modified")]
    public long ModifyTime { get; set; }
}
