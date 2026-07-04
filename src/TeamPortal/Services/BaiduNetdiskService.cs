using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// Baidu Netdisk (百度网盘) integration for large file cloud storage.
/// Uses OAuth 2.0 with client credentials flow.
/// </summary>
public class BaiduNetdiskService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly LogService _log;
    private readonly string _appKey;
    private readonly string _secretKey;
    private readonly string _signKey;
    private string? _accessToken;
    private DateTime _tokenExpiry = DateTime.MinValue;

    private const string OAuthUrl = "https://openapi.baidu.com/oauth/2.0/token";
    private const string AuthUrl = "https://openapi.baidu.com/oauth/2.0/authorize";
    private const string ApiBase = "https://pan.baidu.com/rest/2.0/xpan";
    private static readonly string _tokenFile = Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "baidu-token.json");

    public BaiduNetdiskService(HttpClient http, IConfiguration config, LogService log)
    {
        _http = http;
        _config = config;
        _log = log;
        _appKey = config.GetValue<string>("Baidu:AppKey") ?? "";
        _secretKey = config.GetValue<string>("Baidu:SecretKey") ?? "";
        _signKey = config.GetValue<string>("Baidu:SignKey") ?? "";
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_appKey) && !string.IsNullOrEmpty(_secretKey);

    /// <summary>
    /// Get the Baidu OAuth authorization URL. Admin must visit this once to grant access.
    /// </summary>
    public string GetAuthUrl()
    {
        var redirectUri = "oob"; // Out-of-band — shows code on screen
        return $"{AuthUrl}?response_type=code&client_id={_appKey}&redirect_uri={redirectUri}&scope=basic,netdisk&display=page";
    }

    /// <summary>
    /// Exchange authorization code for tokens. Stores refresh token for future use.
    /// </summary>
    public async Task<string> ExchangeCode(string code)
    {
        var url = $"{OAuthUrl}?grant_type=authorization_code&code={code}&client_id={_appKey}&client_secret={_secretKey}&redirect_uri=oob";
        var resp = await _http.GetAsync(url);
        var body = await resp.Content.ReadAsStringAsync();

        if (!body.TrimStart().StartsWith('{'))
            throw new InvalidOperationException($"授权失败: {body[..Math.Min(200, body.Length)]}");

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("error", out var err))
            throw new InvalidOperationException($"授权错误: {err.GetString()}");

        _accessToken = doc.RootElement.GetProperty("access_token").GetString()!;
        var refreshToken = doc.RootElement.GetProperty("refresh_token").GetString()!;
        var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();
        _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 300);

        // Store refresh token
        File.WriteAllText(_tokenFile, JsonSerializer.Serialize(new { refresh_token = refreshToken }));
        _log.Info("baidu", "Netdisk authorized successfully, refresh token stored");
        return "授权成功！网盘功能已可用";
    }

    private async Task<string> GetAccessToken()
    {
        if (!string.IsNullOrEmpty(_accessToken) && DateTime.UtcNow < _tokenExpiry)
            return _accessToken;

        // Try refresh token first (from stored file)
        if (File.Exists(_tokenFile))
        {
            try
            {
                var stored = JsonSerializer.Deserialize<StoredToken>(File.ReadAllText(_tokenFile));
                if (stored?.refresh_token != null)
                {
                    var url = $"{OAuthUrl}?grant_type=refresh_token&refresh_token={stored.refresh_token}&client_id={_appKey}&client_secret={_secretKey}";
                    var r = await _http.GetAsync(url);
                    var b = await r.Content.ReadAsStringAsync();
                    if (b.TrimStart().StartsWith('{'))
                    {
                        using var d = JsonDocument.Parse(b);
                        if (!d.RootElement.TryGetProperty("error", out _))
                        {
                            _accessToken = d.RootElement.GetProperty("access_token").GetString()!;
                            var exp = d.RootElement.GetProperty("expires_in").GetInt32();
                            _tokenExpiry = DateTime.UtcNow.AddSeconds(exp - 300);
                            if (d.RootElement.TryGetProperty("refresh_token", out var rt))
                                File.WriteAllText(_tokenFile, JsonSerializer.Serialize(new StoredToken { refresh_token = rt.GetString()! }));
                            return _accessToken;
                        }
                    }
                }
            }
            catch (Exception ex) { _log.Warn("baidu", $"Refresh token failed: {ex.Message}"); }
        }

        // Fallback: client credentials (limited scope)
        var curl = $"{OAuthUrl}?grant_type=client_credentials&client_id={_appKey}&client_secret={_secretKey}";
        var resp = await _http.GetAsync(curl);
        var body = await resp.Content.ReadAsStringAsync();
        if (!body.TrimStart().StartsWith('{')) throw new InvalidOperationException("百度网盘未授权，请先完成一次性授权");
        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("error", out var err)) throw new InvalidOperationException($"授权错误: {err.GetString()}");
        _accessToken = doc.RootElement.GetProperty("access_token").GetString()!;
        _tokenExpiry = DateTime.UtcNow.AddSeconds(doc.RootElement.GetProperty("expires_in").GetInt32() - 300);
        return _accessToken;
    }

    private class StoredToken { public string refresh_token { get; set; } = ""; }

    /// <summary>
    /// Upload a file to Baidu Netdisk. Returns the cloud file path.
    /// </summary>
    public async Task<string> UploadFile(string localPath, string remotePath, IProgress<int>? progress = null)
    {
        var token = await GetAccessToken();
        var fileName = Path.GetFileName(localPath);
        var fileSize = new FileInfo(localPath).Length;

        // Pre-create upload
        var precreate = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "precreate",
            ["access_token"] = token,
            ["path"] = remotePath,
            ["size"] = fileSize.ToString(),
            ["isdir"] = "0",
            ["autoinit"] = "1",
            ["rtype"] = "3", // overwrite
        });

        var preResp = await _http.PostAsync($"{ApiBase}/file?method=precreate", precreate);
        var preBody = await preResp.Content.ReadAsStringAsync();
        using var preDoc = JsonDocument.Parse(preBody);
        var uploadId = preDoc.RootElement.GetProperty("uploadid").GetString()!;

        // Upload file in chunks
        var chunkSize = 4 * 1024 * 1024; // 4MB chunks
        var chunks = (int)Math.Ceiling((double)fileSize / chunkSize);
        var fs = File.OpenRead(localPath);
        var buffer = new byte[chunkSize];

        for (int i = 0; i < chunks; i++)
        {
            var bytesRead = await fs.ReadAsync(buffer, 0, chunkSize);
            var chunk = new ByteArrayContent(buffer, 0, bytesRead);

            var uploadContent = new MultipartFormDataContent
            {
                { new StringContent("upload"), "method" },
                { new StringContent(token), "access_token" },
                { new StringContent("tmpfile"), "type" },
                { new StringContent(remotePath), "path" },
                { new StringContent(uploadId), "uploadid" },
                { new StringContent(i.ToString()), "partseq" },
                { chunk, "file", fileName }
            };

            var upResp = await _http.PostAsync($"{ApiBase}/file?method=upload", uploadContent);
            var upBody = await upResp.Content.ReadAsStringAsync();
            progress?.Report((int)((float)(i + 1) / chunks * 100));
        }
        fs.Close();

        // Create file
        var create = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "create",
            ["access_token"] = token,
            ["path"] = remotePath,
            ["size"] = fileSize.ToString(),
            ["isdir"] = "0",
            ["uploadid"] = uploadId,
            ["rtype"] = "3",
        });

        await _http.PostAsync($"{ApiBase}/file?method=create", create);
        _log.Info("baidu", $"File uploaded: {fileName} ({fileSize} bytes) → {remotePath}");
        return remotePath;
    }

    /// <summary>
    /// Get download link for a file.
    /// </summary>
    public async Task<string> GetDownloadUrl(string remotePath)
    {
        var token = await GetAccessToken();
        var resp = await _http.GetAsync($"{ApiBase}/file?method=filemetas&access_token={token}&path={Uri.EscapeDataString(remotePath)}&dlink=1");
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var list = doc.RootElement.GetProperty("list")[0];
        var dlink = list.GetProperty("dlink").GetString()!;
        // Baidu requires access_token appended to download URL
        return $"{dlink}&access_token={token}";
    }

    /// <summary>
    /// List files in a directory.
    /// </summary>
    public async Task<List<BaiduFile>> ListFiles(string remoteDir = "/")
    {
        var token = await GetAccessToken();
        var resp = await _http.GetAsync($"{ApiBase}/file?method=list&access_token={token}&dir={Uri.EscapeDataString(remoteDir)}&order=time&desc=1&limit=100");
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var list = doc.RootElement.GetProperty("list");
        var files = new List<BaiduFile>();
        foreach (var f in list.EnumerateArray())
        {
            files.Add(new BaiduFile
            {
                Path = f.GetProperty("path").GetString()!,
                Name = f.GetProperty("server_filename").GetString()!,
                Size = f.GetProperty("size").GetInt64(),
                IsDir = f.GetProperty("isdir").GetInt32() == 1,
                Modified = f.GetProperty("server_mtime").GetInt64(),
            });
        }
        return files;
    }

    /// <summary>
    /// Delete a file from Baidu Netdisk.
    /// </summary>
    public async Task<bool> DeleteFile(string remotePath)
    {
        var token = await GetAccessToken();
        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "filemanager",
            ["access_token"] = token,
            ["opera"] = "delete",
        });
        var resp = await _http.PostAsync($"{ApiBase}/file?method=filemanager&access_token={token}&opera=delete&async=0&filelist={Uri.EscapeDataString($"[\\\"{remotePath}\\\"]")}", null);
        _log.Info("baidu", $"File deleted: {remotePath}");
        return resp.IsSuccessStatusCode;
    }

    /// <summary>
    /// Get storage quota info.
    /// </summary>
    public async Task<object> GetQuota()
    {
        var token = await GetAccessToken();
        var resp = await _http.GetAsync($"{ApiBase}/file?method=info&access_token={token}");
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        return new
        {
            total = doc.RootElement.GetProperty("total").GetInt64(),
            used = doc.RootElement.GetProperty("used").GetInt64(),
            free = doc.RootElement.GetProperty("total").GetInt64() - doc.RootElement.GetProperty("used").GetInt64(),
        };
    }
}

public class BaiduFile
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public long Size { get; set; }
    public bool IsDir { get; set; }
    public long Modified { get; set; }
}
