using System.IO.Compression;
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

    public async Task<string> UploadFile(string localPath, string remotePath, IProgress<int>? progress = null)
    {
        if (!File.Exists(localPath))
            throw new FileNotFoundException($"Upload source not found: {localPath}");

        var token = await GetAccessToken();
        var fileName = Path.GetFileName(localPath);
        var fileSize = new FileInfo(localPath).Length;

        if (fileSize == 0)
            throw new InvalidOperationException("Cannot upload empty file");

        _log.Info("baidu", $"Upload start: {fileName} ({fileSize} bytes) → {remotePath}");

        // Calculate block MD5s locally BEFORE precreate (4MB chunks)
        const int chunkSize = 4 * 1024 * 1024;
        var blockList = new List<string>();

        using (var fs = File.OpenRead(localPath))
        {
            var buffer = new byte[chunkSize];
            int bytesRead;
            while ((bytesRead = fs.Read(buffer, 0, chunkSize)) > 0)
            {
                var hash = System.Security.Cryptography.MD5.HashData(buffer.AsSpan(0, bytesRead));
                blockList.Add(Convert.ToHexStringLower(hash));
            }
        }

        _log.Info("baidu", $"Upload: {blockList.Count} chunk(s), total {fileSize} bytes");

        // Step 1: Pre-create with block_list
        var blockListJson = JsonSerializer.Serialize(blockList);
        var precreate = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["path"] = remotePath,
            ["size"] = fileSize.ToString(),
            ["isdir"] = "0",
            ["autoinit"] = "1",
            ["rtype"] = "3",
            ["block_list"] = blockListJson,
        });

        _log.Info("baidu", "Upload step 1/3: precreate...");
        var preResp = await _http.PostAsync($"{ApiBase}/file?method=precreate&access_token={token}", precreate);
        var preBody = await ReadBodyAsync(preResp.Content);
        using var preDoc = JsonDocument.Parse(preBody);

        if (!CheckBaiduError(preDoc.RootElement, "precreate", preBody))
            throw new InvalidOperationException($"Pre-create failed: {preBody}");

        if (!preDoc.RootElement.TryGetProperty("uploadid", out var uploadIdProp))
            throw new InvalidOperationException($"Pre-create missing uploadid: {preBody}");

        var uploadId = uploadIdProp.GetString()!;
        _log.Info("baidu", $"Upload step 1/3 OK: uploadid={uploadId[..Math.Min(12, uploadId.Length)]}...");

        // Step 2: Upload chunks via superfile2 (multipart/form-data, field name "file")
        var uploadedMd5s = new List<string>();

        using var fs2 = File.OpenRead(localPath);
        var chunkBuffer = new byte[chunkSize];

        for (int i = 0; i < blockList.Count; i++)
        {
            var bytesRead = await fs2.ReadAsync(chunkBuffer, 0, chunkSize);

            var uploadUrl = $"{UploadBase}?method=upload&access_token={token}&path={Uri.EscapeDataString(remotePath)}&type=tmpfile&uploadid={uploadId}&partseq={i}";

            using var multipart = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(chunkBuffer, 0, bytesRead);
            fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            multipart.Add(fileContent, "file", $"part_{i}");

            var uploadResp = await _http.PostAsync(uploadUrl, multipart);
            var uploadBody = await ReadBodyAsync(uploadResp.Content);
            using var uploadDoc = JsonDocument.Parse(uploadBody);

            if (!CheckBaiduError(uploadDoc.RootElement, $"upload-chunk-{i}", uploadBody))
                throw new InvalidOperationException($"Upload chunk {i}/{blockList.Count} failed: {uploadBody}");

            // Use server-returned MD5, fall back to local MD5
            if (uploadDoc.RootElement.TryGetProperty("md5", out var md5))
                uploadedMd5s.Add(md5.GetString()!);
            else
                uploadedMd5s.Add(blockList[i]);

            progress?.Report((int)((float)(i + 1) / blockList.Count * 100));
        }

        _log.Info("baidu", $"Upload step 2/3 OK: {blockList.Count} chunk(s) uploaded");

        // Step 3: Create file entry with server-returned MD5s
        _log.Info("baidu", "Upload step 3/3: create...");
        var create = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["path"] = remotePath,
            ["size"] = fileSize.ToString(),
            ["isdir"] = "0",
            ["uploadid"] = uploadId,
            ["rtype"] = "3",
            ["block_list"] = JsonSerializer.Serialize(uploadedMd5s),
        });

        var createResp = await _http.PostAsync($"{ApiBase}/file?method=create&access_token={token}", create);
        var createBody = await ReadBodyAsync(createResp.Content);
        using var createDoc = JsonDocument.Parse(createBody);

        if (!CheckBaiduError(createDoc.RootElement, "create", createBody))
            throw new InvalidOperationException($"Create file failed: {createBody}");

        _log.Info("baidu", $"Upload OK: {fileName} ({fileSize} bytes) → {remotePath}");
        return remotePath;
    }

    /// <summary>
    /// Stream file download through backend. Handles all file sizes.
    /// </summary>
    public async Task<(Stream stream, string fileName, long size)> GetDownloadStream(long fsId)
    {
        if (fsId <= 0)
            throw new ArgumentException("Invalid fsId", nameof(fsId));

        var token = await GetAccessToken();
        _log.Info("baidu", $"Download start: fsId={fsId}");

        // Get dlink via filemetas
        var metaUrl = $"{ApiBase}/file?method=filemetas&access_token={token}&fsids=[{fsId}]&dlink=1";
        var metaResp = await _http.GetAsync(metaUrl);
        var metaBody = await ReadBodyAsync(metaResp.Content);
        using var metaDoc = JsonDocument.Parse(metaBody);

        if (!CheckBaiduError(metaDoc.RootElement, "filemetas", metaBody))
            throw new InvalidOperationException($"File meta failed: {metaBody}");

        var list = metaDoc.RootElement.GetProperty("info");
        if (list.GetArrayLength() == 0)
            throw new InvalidOperationException($"File not found: fsId={fsId}");

        var file = list[0];
        var fileName = file.TryGetProperty("server_filename", out var sn) ? sn.GetString()! :
                       file.TryGetProperty("filename", out var fn) ? fn.GetString()! :
                       "unknown";
        var size = file.TryGetProperty("size", out var sz) ? sz.GetInt64() : 0;
        var dlink = file.TryGetProperty("dlink", out var dl) ? dl.GetString() : null;

        if (string.IsNullOrEmpty(dlink))
            throw new InvalidOperationException($"No dlink returned for fsId={fsId}: {metaBody[..Math.Min(200, metaBody.Length)]}");

        _log.Info("baidu", $"Download: {fileName} ({size} bytes), dlink obtained");

        var dlUrl = $"{dlink}&access_token={token}";
        var req = new HttpRequestMessage(HttpMethod.Get, dlUrl);
        req.Headers.Add("User-Agent", "pan.baidu.com");
        var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);

        if (!resp.IsSuccessStatusCode)
        {
            var errBody = await ReadBodyAsync(resp.Content);
            throw new InvalidOperationException($"Download failed: HTTP {resp.StatusCode}, body: {errBody[..Math.Min(200, errBody.Length)]}");
        }

        _log.Info("baidu", $"Download OK: {fileName} ({size} bytes)");
        var stream = await resp.Content.ReadAsStreamAsync();
        return (stream, fileName, size);
    }

    public async Task<List<BaiduFile>> ListFiles(string remoteDir = "/")
    {
        var token = await GetAccessToken();
        _log.Info("baidu", $"ListFiles: dir={remoteDir}");
        var url = $"{ApiBase}/file?method=list&access_token={token}&dir={Uri.EscapeDataString(remoteDir)}&limit=1000";
        var resp = await _http.GetAsync(url);
        var body = await ReadBodyAsync(resp.Content);
        using var doc = JsonDocument.Parse(body);

        if (!CheckBaiduError(doc.RootElement, "list", body))
            throw new InvalidOperationException($"List files failed: {body[..Math.Min(200, body.Length)]}");

        var result = new List<BaiduFile>();
        if (doc.RootElement.TryGetProperty("list", out var list))
        {
            foreach (var item in list.EnumerateArray())
            {
                result.Add(new BaiduFile
                {
                    FsId = item.TryGetProperty("fs_id", out var fsId) ? fsId.GetInt64() : 0,
                    Path = item.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "",
                    FileName = item.TryGetProperty("server_filename", out var fn) ? fn.GetString() ?? "" : "",
                    Size = item.TryGetProperty("size", out var sz) ? sz.GetInt64() : 0,
                    IsDir = item.TryGetProperty("isdir", out var isd) && isd.GetInt32() == 1,
                    ModifyTime = item.TryGetProperty("server_mtime", out var mt) ? mt.GetInt64() : 0,
                });
            }
        }

        _log.Info("baidu", $"ListFiles OK: {result.Count} item(s) in {remoteDir}");
        return result;
    }

    public async Task<bool> DeleteFile(string remotePath)
    {
        var token = await GetAccessToken();
        _log.Info("baidu", $"Delete: {remotePath}");
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
        var body = await ReadBodyAsync(resp.Content);
        using var doc = JsonDocument.Parse(body);

        if (!CheckBaiduError(doc.RootElement, "delete", body))
            return false;

        _log.Info("baidu", $"Deleted OK: {remotePath}");
        return true;
    }

    public async Task<object> GetQuota()
    {
        var token = await GetAccessToken();
        _log.Info("baidu", "GetQuota requested");
        var resp = await _http.GetAsync($"{ApiBase}/quota?access_token={token}&checkfree=1&checkexpire=1");
        var body = await ReadBodyAsync(resp.Content);
        using var doc = JsonDocument.Parse(body);

        if (!CheckBaiduError(doc.RootElement, "quota", body))
            return new { totalBytes = 0L, usedBytes = 0L, freeBytes = 0L, totalGb = 0.0, usedGb = 0.0 };

        long total = 0, used = 0;
        if (doc.RootElement.TryGetProperty("total", out var t)) total = t.GetInt64();
        if (doc.RootElement.TryGetProperty("used", out var u)) used = u.GetInt64();

        var result = new
        {
            totalBytes = total,
            usedBytes = used,
            freeBytes = total - used,
            totalGb = Math.Round(total / 1024.0 / 1024.0 / 1024.0, 2),
            usedGb = Math.Round(used / 1024.0 / 1024.0 / 1024.0, 2),
        };
        _log.Info("baidu", $"GetQuota OK: {result.totalGb}GB total, {result.usedGb}GB used");
        return result;
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
        var body = await ReadBodyAsync(resp.Content);
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
    /// 创建系统完整备份并上传到百度网盘。
    /// 备份内容：SQLite 数据库 + 系统设置 + 知识库 + Wiki 文档 + 飞行日志。
    /// </summary>
    /// <returns>网盘中的备份文件路径</returns>
    public async Task<string> BackupSystem()
    {
        await GetAccessToken(); // ensure auth
        var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var zipName = $"backup-{timestamp}.zip";
        var zipPath = Path.Combine(Path.GetTempPath(), zipName);
        var remotePath = $"{RootDir}/system/backups/{zipName}";

        _log.Info("baidu", $"System backup start: {zipName}");

        var contentRoot = Directory.GetCurrentDirectory();
        var dbPath = Path.Combine(contentRoot, "data", "teamportal.db");
        var dataDir = Path.GetFullPath(Path.Combine(contentRoot, "..", "..", "data"));

        using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
        {
            // 1. SQLite database snapshot
            if (File.Exists(dbPath))
            {
                var tmpDb = Path.Combine(Path.GetTempPath(), $"backup-db-{timestamp}.db");
                File.Copy(dbPath, tmpDb, true);
                zip.CreateEntryFromFile(tmpDb, "teamportal.db");
                File.Delete(tmpDb);
                _log.Info("baidu", $"Backup: DB ({new FileInfo(dbPath).Length} bytes)");
            }

            // 2. System settings as JSON
            var settings = await _settings.GetAllGrouped();
            var settingsJson = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
            var entry = zip.CreateEntry("settings.json");
            using (var writer = new StreamWriter(entry.Open(), Encoding.UTF8))
                await writer.WriteAsync(settingsJson);
            _log.Info("baidu", "Backup: settings");

            // 3. Knowledge base + Wiki documents
            AddDirectoryToZip(zip, Path.Combine(dataDir, "knowledge"), "knowledge/");

            // 4. Flight logs
            AddDirectoryToZip(zip, Path.Combine(dataDir, "flightlogs"), "flightlogs/");
        }

        var zipSize = new FileInfo(zipPath).Length;
        _log.Info("baidu", $"Backup zip: {zipSize} bytes");

        // Upload zip to cloud (fallback: save locally)
        try
        {
            await UploadFile(zipPath, remotePath);
        }
        catch (Exception ex)
        {
            _log.Error("baidu", $"Backup upload failed, keeping local copy: {ex.Message}");
            var localBackupDir = Path.Combine(contentRoot, "data", "backups");
            Directory.CreateDirectory(localBackupDir);
            var localPath = Path.Combine(localBackupDir, zipName);
            File.Copy(zipPath, localPath, true);
            File.Delete(zipPath);
            return localPath;
        }

        File.Delete(zipPath);
        _log.Info("baidu", $"System backup OK: {remotePath}");
        return remotePath;
    }

    /// <summary>Recursively add a directory to a zip archive. Returns file count added.</summary>
    private int AddDirectoryToZip(ZipArchive zip, string sourceDir, string entryPrefix)
    {
        if (!Directory.Exists(sourceDir)) return 0;
        var files = Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories);
        foreach (var file in files)
        {
            var relativePath = Path.GetRelativePath(sourceDir, file).Replace('\\', '/');
            zip.CreateEntryFromFile(file, entryPrefix + relativePath);
        }
        if (files.Length > 0)
            _log.Info("baidu", $"Backup: {entryPrefix.TrimEnd('/')} ({files.Length} files)");
        return files.Length;
    }

    /// <summary>
    /// 一键创建系统所需的完整文件夹结构。
    /// /apps/team-portal/
    /// ├── system/
    /// │   ├── backups/
    /// │   ├── logs/
    /// │   └── configs/
    /// └── user-data/
    ///     ├── flight-logs/
    ///     ├── photos-videos/
    ///     └── documents/
    /// </summary>
    public async Task EnsureFolderStructure()
    {
        // Create parent dirs first, then children (API doesn't auto-create parents)
        var dirs = new[]
        {
            $"{RootDir}/system",
            $"{RootDir}/user-data",
            $"{RootDir}/system/backups",
            $"{RootDir}/system/logs",
            $"{RootDir}/system/configs",
            $"{RootDir}/user-data/flight-logs",
            $"{RootDir}/user-data/photos-videos",
            $"{RootDir}/user-data/documents",
        };

        _log.Info("baidu", $"EnsureFolderStructure: creating {dirs.Length} directories...");
        int created = 0, existed = 0;

        foreach (var dir in dirs)
        {
            if (await CreateDirectory(dir))
                created++;
            else
                existed++;
        }

        _log.Info("baidu", $"Folder structure done: {created} created, {existed} already existed");
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
