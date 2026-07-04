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
    private const string ApiBase = "https://pan.baidu.com/rest/2.0";

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

    private async Task<string> GetAccessToken()
    {
        if (!string.IsNullOrEmpty(_accessToken) && DateTime.UtcNow < _tokenExpiry)
            return _accessToken;

        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["client_id"] = _appKey,
            ["client_secret"] = _secretKey,
        });

        var resp = await _http.PostAsync(OAuthUrl, content);
        var body = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
        {
            _log.Error("baidu", $"OAuth failed: {body[..Math.Min(body.Length, 200)]}");
            throw new InvalidOperationException("百度网盘授权失败");
        }

        using var doc = JsonDocument.Parse(body);
        _accessToken = doc.RootElement.GetProperty("access_token").GetString()!;
        var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();
        _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 300); // 5 min buffer
        _log.Info("baidu", "Netdisk OAuth token obtained");
        return _accessToken;
    }

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
        return list.GetProperty("dlink").GetString()!;
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
