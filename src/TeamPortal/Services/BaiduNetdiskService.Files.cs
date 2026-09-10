using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// BaiduNetdiskService 的文件读取部分：下载流、文件列表(分页)。
/// </summary>
public partial class BaiduNetdiskService
{
    /// <summary>
    /// Stream file download through backend. Handles all file sizes.
    /// </summary>
    /// <remarks>
    /// 返回的 Stream 归调用方所有:必须 await using / using 释放,
    /// 否则底层 HttpResponseMessage 与连接不会归还连接池。
    /// </remarks>
    public async Task<(Stream stream, string fileName, long size)> GetDownloadStream(long fsId, CancellationToken ct = default)
    {
        if (fsId <= 0)
            throw new ArgumentException("Invalid fsId", nameof(fsId));

        var token = await GetAccessToken(ct);
        _log.Info("baidu", $"Download start: fsId={fsId}");

        // Get dlink via filemetas
        var metaUrl = $"{ApiBase}/file?method=filemetas&access_token={token}&fsids=[{fsId}]&dlink=1";
        string metaBody;
        using (var metaResp = await _http.GetAsync(metaUrl, ct))
            metaBody = await ReadBodyAsync(metaResp.Content, ct);
        using var metaDoc = JsonDocument.Parse(metaBody);

        if (!CheckBaiduError(metaDoc.RootElement, "filemetas", metaBody))
            throw new InvalidOperationException($"File meta failed: {RedactSecrets(metaBody[..Math.Min(200, metaBody.Length)])}");

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
            throw new InvalidOperationException($"No dlink returned for fsId={fsId}: {RedactSecrets(metaBody[..Math.Min(200, metaBody.Length)])}");

        _log.Info("baidu", $"Download: {fileName} ({size} bytes), dlink obtained");

        var dlUrl = $"{dlink}&access_token={token}";
        using var req = new HttpRequestMessage(HttpMethod.Get, dlUrl);
        req.Headers.Add("User-Agent", "pan.baidu.com");
        var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

        if (!resp.IsSuccessStatusCode)
        {
            var status = resp.StatusCode;
            var errBody = await ReadBodyAsync(resp.Content, ct);
            resp.Dispose(); // 错误分支不返回 stream,必须自己释放
            throw new InvalidOperationException($"Download failed: HTTP {status}, body: {RedactSecrets(errBody[..Math.Min(200, errBody.Length)])}");
        }

        _log.Info("baidu", $"Download OK: {fileName} ({size} bytes)");
        // 注意:此处不能 using resp —— 响应生命周期交给返回的 stream,由调用方释放
        var stream = await resp.Content.ReadAsStreamAsync(ct);
        return (stream, fileName, size);
    }

    /// <summary>
    /// 列出目录下全部文件。百度 list 接口单次最多 1000 条且不会自动翻页,
    /// 必须用 start 循环累加,否则目录超过 1000 项时后半部分会静默丢失。
    /// </summary>
    public async Task<List<BaiduFile>> ListFiles(string remoteDir = "/", CancellationToken ct = default)
    {
        var token = await GetAccessToken(ct);
        _log.Info("baidu", $"ListFiles: dir={remoteDir}");

        const int pageSize = 1000;
        var result = new List<BaiduFile>();

        for (var start = 0; ; start += pageSize)
        {
            ct.ThrowIfCancellationRequested();
            // 不传 order/desc,沿用百度默认(按文件名)保证翻页顺序稳定
            var url = $"{ApiBase}/file?method=list&access_token={token}&dir={Uri.EscapeDataString(remoteDir)}&start={start}&limit={pageSize}";
            string body;
            using (var resp = await _http.GetAsync(url, ct))
                body = await ReadBodyAsync(resp.Content, ct);
            using var doc = JsonDocument.Parse(body);

            if (!CheckBaiduError(doc.RootElement, "list", body))
                throw new InvalidOperationException($"List files failed: {RedactSecrets(body[..Math.Min(200, body.Length)])}");

            if (!doc.RootElement.TryGetProperty("list", out var list) || list.GetArrayLength() == 0)
                break;

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

            if (list.GetArrayLength() < pageSize) break; // 已取完
        }

        _log.Info("baidu", $"ListFiles OK: {result.Count} item(s) in {remoteDir}");
        return result;
    }
}
