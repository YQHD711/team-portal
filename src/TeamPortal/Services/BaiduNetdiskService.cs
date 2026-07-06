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
    private readonly SettingsService _settings;
    private readonly LogService _log;
    private static string? _accessToken;
    private static DateTime _tokenExpiry = DateTime.MinValue;
    private static readonly SemaphoreSlim _tokenSemaphore = new(1, 1);

    private const string OAuthUrl = "https://openapi.baidu.com/oauth/2.0/token";
    private const string AuthUrl = "https://openapi.baidu.com/oauth/2.0/authorize";
    private const string DeviceAuthUrl = "https://openapi.baidu.com/oauth/2.0/device/code";
    private const string ApiBase = "https://pan.baidu.com/rest/2.0/xpan";
    private const string RedirectUri = "oob";

    /// <summary>系统在百度网盘中的根目录</summary>
    public const string RootDir = "/雏鹰之翼航模队";
    /// <summary>用户上传文件的默认目录</summary>
    public const string DefaultUploadDir = RootDir + "/用户数据/文档资料";

    private static string TokenFile => Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "baidu-token.json"));

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
        var body = await resp.Content.ReadAsStringAsync();
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
        // Fast path — return cached token without lock
        if (!string.IsNullOrEmpty(_accessToken) && DateTime.UtcNow < _tokenExpiry)
            return _accessToken;

        await _tokenSemaphore.WaitAsync();
        try
        {
            // Double-check after acquiring lock
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
                    var body = await resp.Content.ReadAsStringAsync();

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
            ["rtype"] = "3",
            ["block_list"] = $"[\"{Guid.NewGuid():N}\"]",
        });

        var preResp = await _http.PostAsync($"{ApiBase}/file", precreate);
        var preBody = await preResp.Content.ReadAsStringAsync();

        using var preDoc = JsonDocument.Parse(preBody);
        if (preDoc.RootElement.TryGetProperty("errno", out var preErrno) && preErrno.GetInt32() != 0)
            throw new InvalidOperationException($"Pre-create failed: {preBody}");

        var uploadId = preDoc.RootElement.GetProperty("uploadid").GetString()!;

        // Upload file content
        var fileContent = await File.ReadAllBytesAsync(localPath);
        var uploadContent = new ByteArrayContent(fileContent);
        uploadContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

        var uploadUrl = $"{ApiBase}/file?method=upload&access_token={token}&uploadid={uploadId}&partseq=0";
        var uploadResp = await _http.PostAsync(uploadUrl, uploadContent);
        var uploadBody = await uploadResp.Content.ReadAsStringAsync();

        using var uploadDoc = JsonDocument.Parse(uploadBody);
        if (uploadDoc.RootElement.TryGetProperty("errno", out var uploadErrno) && uploadErrno.GetInt32() != 0)
            throw new InvalidOperationException($"Upload failed: {uploadBody}");

        // Create file entry
        var create = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "create",
            ["access_token"] = token,
            ["path"] = remotePath,
            ["size"] = fileSize.ToString(),
            ["isdir"] = "0",
            ["uploadid"] = uploadId,
            ["rtype"] = "3",
            ["block_list"] = $"[\"{uploadDoc.RootElement.GetProperty("md5").GetString()}\"]",
        });

        await _http.PostAsync($"{ApiBase}/file?method=create", create);
        _log.Info("baidu", $"File uploaded: {fileName} ({fileSize} bytes) → {remotePath}");
        return remotePath;
    }

    /// <summary>
    /// Stream file download through backend. Handles all file sizes.
    /// </summary>
    public async Task<(Stream stream, string fileName, long size)> GetDownloadStream(long fsId)
    {
        var token = await GetAccessToken();

        // Get dlink
        var metaUrl = $"{ApiBase}/file?method=filemetas&access_token={token}&fsids=[{fsId}]&dlink=1";
        var metaResp = await _http.GetAsync(metaUrl);
        var metaBody = await metaResp.Content.ReadAsStringAsync();
        using var metaDoc = JsonDocument.Parse(metaBody);

        if (metaDoc.RootElement.TryGetProperty("errno", out var errno) && errno.GetInt32() != 0)
            throw new InvalidOperationException($"File meta failed: {metaBody}");

        var list = metaDoc.RootElement.GetProperty("list");
        if (list.GetArrayLength() == 0)
            throw new InvalidOperationException("File not found");

        var file = list[0];
        var fileName = file.GetProperty("filename").GetString()!;
        var size = file.GetProperty("size").GetInt64();
        var dlink = file.GetProperty("dlink").GetString()!;

        var req = new HttpRequestMessage(HttpMethod.Get, dlink);
        req.Headers.Add("User-Agent", "pan.baidu.com");
        var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);

        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Download failed: HTTP {resp.StatusCode}");

        var stream = await resp.Content.ReadAsStreamAsync();
        return (stream, fileName, size);
    }

    public async Task<List<BaiduFile>> ListFiles(string remoteDir = "/")
    {
        var token = await GetAccessToken();
        var url = $"{ApiBase}/file?method=list&access_token={token}&dir={Uri.EscapeDataString(remoteDir)}&limit=1000";
        var resp = await _http.GetAsync(url);
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);

        if (doc.RootElement.TryGetProperty("errno", out var errno) && errno.GetInt32() != 0)
            throw new InvalidOperationException($"List files failed: {body}");

        var result = new List<BaiduFile>();
        if (doc.RootElement.TryGetProperty("list", out var list))
        {
            foreach (var item in list.EnumerateArray())
            {
                result.Add(new BaiduFile
                {
                    FsId = item.TryGetProperty("fs_id", out var fsId) ? fsId.GetInt64() : 0,
                    Path = item.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "",
                    FileName = item.TryGetProperty("filename", out var fn) ? fn.GetString() ?? "" : "",
                    Size = item.TryGetProperty("size", out var sz) ? sz.GetInt64() : 0,
                    IsDir = item.TryGetProperty("isdir", out var isd) && isd.GetInt32() == 1,
                    ModifyTime = item.TryGetProperty("server_mtime", out var mt) ? mt.GetInt64() : 0,
                });
            }
        }

        return result;
    }

    public async Task<bool> DeleteFile(string remotePath)
    {
        var token = await GetAccessToken();
        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "filemanager",
            ["access_token"] = token,
            ["opera"] = "delete",
            ["async"] = "0",
            ["ondup"] = "fail",
            ["filelist"] = $"[{{\"path\":\"{remotePath}\"}}]",
        });

        var resp = await _http.PostAsync($"{ApiBase}/file", content);
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);

        if (doc.RootElement.TryGetProperty("errno", out var errno) && errno.GetInt32() != 0)
        {
            _log.Error("baidu", $"Delete failed: {body}");
            return false;
        }

        _log.Info("baidu", $"Deleted: {remotePath}");
        return true;
    }

    public async Task<object> GetQuota()
    {
        var token = await GetAccessToken();
        var resp = await _http.GetAsync($"{ApiBase}/quota?access_token={token}&checkfree=1&checkexpire=1");
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);

        long total = 0, used = 0;
        if (doc.RootElement.TryGetProperty("total", out var t)) total = t.GetInt64();
        if (doc.RootElement.TryGetProperty("used", out var u)) used = u.GetInt64();

        return new
        {
            totalBytes = total,
            usedBytes = used,
            freeBytes = total - used,
            totalGb = Math.Round(total / 1024.0 / 1024.0 / 1024.0, 2),
            usedGb = Math.Round(used / 1024.0 / 1024.0 / 1024.0, 2),
        };
    }

    /// <summary>
    /// 在百度网盘中创建一个文件夹。
    /// 使用 filemanager 接口的 opera=create。
    /// </summary>
    /// <param name="remotePath">远程路径，如 /雏鹰之翼航模队/系统数据</param>
    /// <returns>true=创建成功, false=已存在或创建失败</returns>
    public async Task<bool> CreateDirectory(string remotePath)
    {
        var token = await GetAccessToken();
        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "filemanager",
            ["access_token"] = token,
            ["opera"] = "create",
            ["async"] = "0",
            ["ondup"] = "fail",
            ["filelist"] = $"[{{\"path\":\"{remotePath}\",\"isdir\":1,\"size\":0}}]",
        });

        var resp = await _http.PostAsync($"{ApiBase}/file", content);
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);

        if (doc.RootElement.TryGetProperty("errno", out var errno))
        {
            if (errno.GetInt32() == 0)
            {
                _log.Info("baidu", $"Directory created: {remotePath}");
                return true;
            }

            // errno 17 = "file already exists" — not an error for our use case
            if (errno.GetInt32() == 17)
            {
                _log.Info("baidu", $"Directory already exists: {remotePath}");
                return false;
            }

            _log.Warn("baidu", $"Create directory '{remotePath}' failed (errno={errno.GetInt32()}): {body[..Math.Min(200, body.Length)]}");
            return false;
        }

        _log.Info("baidu", $"Directory created: {remotePath}");
        return true;
    }

    /// <summary>
    /// 一键创建系统所需的完整文件夹结构。
    /// 根目录：/雏鹰之翼航模队
    /// ├── 系统数据/
    /// │   ├── 备份/
    /// │   ├── 日志/
    /// │   └── 配置/
    /// └── 用户数据/
    ///     ├── 飞行日志/
    ///     ├── 照片视频/
    ///     └── 文档资料/
    /// </summary>
    public async Task EnsureFolderStructure()
    {
        var dirs = new[]
        {
            $"{RootDir}/系统数据/备份",
            $"{RootDir}/系统数据/日志",
            $"{RootDir}/系统数据/配置",
            $"{RootDir}/用户数据/飞行日志",
            $"{RootDir}/用户数据/照片视频",
            $"{RootDir}/用户数据/文档资料",
        };

        foreach (var dir in dirs)
        {
            await CreateDirectory(dir);
        }

        _log.Info("baidu", "Folder structure initialization completed");
    }
}

public class BaiduFile
{
    public long FsId { get; set; }
    public string Path { get; set; } = "";
    public string FileName { get; set; } = "";
    public long Size { get; set; }
    public bool IsDir { get; set; }
    public long ModifyTime { get; set; }
}
