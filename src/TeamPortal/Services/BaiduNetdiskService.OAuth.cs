using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>BaiduNetdiskService 的 OAuth 部分：授权链接、code 兑换、令牌刷新与内存缓存。</summary>
public partial class BaiduNetdiskService
{
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

    public async Task<string> ExchangeCode(string code, CancellationToken ct = default)
    {
        var appKey = await GetAppKey();
        var secretKey = await GetSecretKey();
        var redirectUri = RedirectUri;
        var url = $"{OAuthUrl}?grant_type=authorization_code&code={code}&client_id={appKey}&client_secret={secretKey}&redirect_uri={Uri.EscapeDataString(redirectUri)}";
        _log.Info("baidu", "Exchanging code for token...");

        string body;
        using (var resp = await _http.GetAsync(url, ct))
            body = await ReadBodyAsync(resp.Content, ct);

        if (!body.TrimStart().StartsWith('{'))
            throw new InvalidOperationException($"授权失败，返回非JSON: {RedactSecrets(body[..Math.Min(200, body.Length)])}");

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

        await File.WriteAllTextAsync(TokenFile, JsonSerializer.Serialize(new { refresh_token = refreshToken }), ct);
        // 只记录非敏感字段:OAuth 响应体含 access_token / refresh_token,不能整体落日志
        var scope = doc.RootElement.TryGetProperty("scope", out var sc) ? sc.GetString() : null;
        _log.Info("baidu", $"Netdisk authorized. Token expires in {expiresIn}s, scope={scope ?? "-"}, refresh_token stored");
        return "授权成功！网盘功能已可用";
    }

    private async Task<string> GetAccessToken(CancellationToken ct = default)
    {
        await _tokenSemaphore.WaitAsync(ct);
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
                    string body;
                    using (var resp = await _http.GetAsync(refreshUrl, ct))
                        body = await ReadBodyAsync(resp.Content, ct);

                    if (body.TrimStart().StartsWith('{'))
                    {
                        using var doc = JsonDocument.Parse(body);
                        if (!doc.RootElement.TryGetProperty("error", out _))
                        {
                            _accessToken = doc.RootElement.GetProperty("access_token").GetString()!;
                            var newRefresh = doc.RootElement.GetProperty("refresh_token").GetString()!;
                            var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();
                            _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 300);
                            await File.WriteAllTextAsync(TokenFile, JsonSerializer.Serialize(new { refresh_token = newRefresh }), ct);
                            _log.Info("baidu", $"Token refreshed, expires in {expiresIn}s");
                            return _accessToken;
                        }
                    }

                    _log.Warn("baidu", $"Token refresh failed: {RedactSecrets(body[..Math.Min(200, body.Length)])}");
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
