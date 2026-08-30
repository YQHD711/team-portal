using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// BaiduNetdiskService 的文件管理部分：下载流、文件列表、删除、配额查询、创建文件夹。
/// </summary>
public partial class BaiduNetdiskService
{
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
}
