using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>BaiduNetdiskService 的文件管理部分：删除、配额查询、创建文件夹。</summary>
public partial class BaiduNetdiskService
{
    public async Task<bool> DeleteFile(string remotePath, CancellationToken ct = default)
    {
        var token = await GetAccessToken(ct);
        _log.Info("baidu", $"Delete: {remotePath}");

        // 路径里的引号/反斜杠会破坏手写 JSON(甚至注入额外路径),统一走序列化
        var fileListJson = JsonSerializer.Serialize(new[] { new { path = remotePath } });
        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "filemanager",
            ["access_token"] = token,
            ["opera"] = "delete",
            ["async"] = "0",
            ["ondup"] = "fail",
            ["filelist"] = fileListJson,
        });

        string body;
        using (var resp = await _http.PostAsync($"{ApiBase}/file", content, ct))
            body = await ReadBodyAsync(resp.Content, ct);
        using var doc = JsonDocument.Parse(body);

        if (!CheckBaiduError(doc.RootElement, "delete", body))
            return false;

        _log.Info("baidu", $"Deleted OK: {remotePath}");
        return true;
    }

    public async Task<object> GetQuota(CancellationToken ct = default)
    {
        var token = await GetAccessToken(ct);
        _log.Info("baidu", "GetQuota requested");
        string body;
        using (var resp = await _http.GetAsync($"{ApiBase}/quota?access_token={token}&checkfree=1&checkexpire=1", ct))
            body = await ReadBodyAsync(resp.Content, ct);
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
    public async Task<bool> CreateDirectory(string remotePath, CancellationToken ct = default)
    {
        var token = await GetAccessToken(ct);

        // 同 DeleteFile:路径必须序列化,不能字符串拼接
        var fileListJson = JsonSerializer.Serialize(new[] { new { path = remotePath, isdir = 1, size = 0 } });
        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["method"] = "filemanager",
            ["access_token"] = token,
            ["opera"] = "create",
            ["async"] = "0",
            ["ondup"] = "fail",
            ["filelist"] = fileListJson,
        });

        string body;
        using (var resp = await _http.PostAsync($"{ApiBase}/file", content, ct))
            body = await ReadBodyAsync(resp.Content, ct);
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

            _log.Warn("baidu", $"Create directory '{remotePath}' failed (errno={errno.GetInt32()}): {RedactSecrets(body[..Math.Min(200, body.Length)])}");
            return false;
        }

        _log.Info("baidu", $"Directory created: {remotePath}");
        return true;
    }
}
