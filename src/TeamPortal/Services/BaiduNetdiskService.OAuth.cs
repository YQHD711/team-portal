using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>BaiduNetdiskService 的 OAuth 部分：授权链接、code 兑换、令牌刷新与内存缓存。</summary>
public partial class BaiduNetdiskService
{
    /// <summary>百度 OAuth 标准有效期（30 天）：仅在 expires_in 缺失或类型异常时兜底，
    /// 避免把有效期算到过去导致每次调用都去刷新。</summary>
    private const int DefaultTokenLifetimeSeconds = 30 * 24 * 3600;

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
            var desc = doc.RootElement.TryGetProperty("error_description", out var d) ? JsonStringOrNumber(d) : "";
            throw new InvalidOperationException($"授权错误: {JsonStringOrNumber(err)} - {desc}");
        }

        var accessToken = ReadTokenField(doc.RootElement, "access_token");
        var refreshToken = ReadTokenField(doc.RootElement, "refresh_token");
        if (string.IsNullOrEmpty(accessToken) || string.IsNullOrEmpty(refreshToken))
            throw new InvalidOperationException($"授权失败：响应缺少 access_token/refresh_token（{RedactSecrets(body[..Math.Min(200, body.Length)])}）");

        var expiresIn = JsonIntOrString(doc.RootElement.GetProperty("expires_in")) ?? DefaultTokenLifetimeSeconds;
        _accessToken = accessToken;
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
            var storedRefreshToken = ReadStoredRefreshToken(TokenFile, out var tokenProblem);
            if (tokenProblem is not null)
                _log.Warn("baidu", tokenProblem);

            if (storedRefreshToken is not null)
            {
                var refreshUrl = $"{OAuthUrl}?grant_type=refresh_token&refresh_token={storedRefreshToken}&client_id={appKey}&client_secret={secretKey}";
                string body;
                using (var resp = await _http.GetAsync(refreshUrl, ct))
                    body = await ReadBodyAsync(resp.Content, ct);

                if (body.TrimStart().StartsWith('{'))
                {
                    using var doc = JsonDocument.Parse(body);
                    if (!doc.RootElement.TryGetProperty("error", out _))
                    {
                        var accessToken = ReadTokenField(doc.RootElement, "access_token");
                        var newRefresh = ReadTokenField(doc.RootElement, "refresh_token");
                        if (!string.IsNullOrEmpty(accessToken) && !string.IsNullOrEmpty(newRefresh))
                        {
                            // expires_in 缺失/类型异常时退回百度标准的 30 天,避免把有效期算到过去
                            // 导致每次调用都重新刷新
                            var expiresIn = JsonIntOrString(doc.RootElement.GetProperty("expires_in"))
                                            ?? DefaultTokenLifetimeSeconds;
                            _accessToken = accessToken;
                            _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 300);
                            await File.WriteAllTextAsync(TokenFile, JsonSerializer.Serialize(new { refresh_token = newRefresh }), ct);
                            _log.Info("baidu", $"Token refreshed, expires in {expiresIn}s");
                            return _accessToken;
                        }
                    }
                }

                _log.Warn("baidu", $"Token refresh failed: {RedactSecrets(body[..Math.Min(200, body.Length)])}");
            }

            throw new InvalidOperationException(
                $"百度网盘未授权或凭据已失效，请在「云存储」页面重新授权（凭据文件：{TokenFile}）");
        }
        finally
        {
            _tokenSemaphore.Release();
        }
    }

    /// <summary>
    /// 宽容读取 token 字段：百度同一字段时而字符串时而数字，直接 GetString() 会抛
    /// "requires an element of type 'String', but the target element has type 'Number'"。
    /// </summary>
    private static string? ReadTokenField(JsonElement root, string name)
        => root.TryGetProperty(name, out var el) ? JsonStringOrNumber(el) : null;

    /// <summary>
    /// 读取本地保存的 refresh_token（内部文件读取 + 纯判断，便于单测）。
    ///
    /// 绝不对 refresh_token 直接调用 <c>GetString()</c>：文件被写坏、字段缺失、
    /// 或值是不带引号的数字时都会抛类型异常。该异常会一路冒到
    /// <c>BackupSystem</c> 的兜底 catch，被记成「备份上传失败」——让人去查上传环节，
    /// 而真正该做的是重新授权（线上就是这么误导排查的）。
    ///
    /// 凭据不可用时把文件改名为 <c>.corrupt-时间戳</c> 留存现场并返回 null，
    /// 由调用方抛出「请重新授权」的明确提示。
    /// </summary>
    /// <param name="problem">不可用时的可读原因；可用时为 null。</param>
    internal static string? ReadStoredRefreshToken(string tokenFile, out string? problem)
    {
        problem = null;
        if (!File.Exists(tokenFile)) return null;

        string? token = null;
        string reason;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(tokenFile));
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                reason = "凭据文件不是 JSON 对象";
            }
            else if (!doc.RootElement.TryGetProperty("refresh_token", out var rt))
            {
                reason = "凭据文件里没有 refresh_token 字段";
            }
            else
            {
                token = JsonStringOrNumber(rt);
                if (string.IsNullOrWhiteSpace(token)) reason = "refresh_token 为空或类型无法识别";
                else return token;
            }
        }
        catch (JsonException) { reason = "凭据文件不是合法 JSON"; }
        catch (Exception ex) { reason = $"凭据文件读取失败（{ex.GetType().Name}）"; }

        problem = $"百度网盘{reason}，已隔离旧文件，需要重新授权：{tokenFile}";
        try { File.Move(tokenFile, $"{tokenFile}.corrupt-{DateTime.Now:yyyyMMdd-HHmmss}", overwrite: true); }
        catch { /* 留存失败不影响主流程 */ }
        return null;
    }
}
