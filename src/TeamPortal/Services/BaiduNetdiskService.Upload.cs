using System.Security.Cryptography;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// BaiduNetdiskService 的上传部分：本地文件分块（4MB）上传，precreate → 逐块 upload → create 三步流程。
/// 分块失败按指数退避重试,并支持秒传/续传（precreate 声明服务端已存在的分块直接跳过）。
/// </summary>
public partial class BaiduNetdiskService
{
    private const int ChunkSize = 4 * 1024 * 1024;
    private const int MaxChunkAttempts = 3;

    public async Task<string> UploadFile(string localPath, string remotePath, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        if (!File.Exists(localPath))
            throw new FileNotFoundException($"Upload source not found: {localPath}");

        var token = await GetAccessToken(ct);
        var fileName = Path.GetFileName(localPath);
        var fileSize = new FileInfo(localPath).Length;

        if (fileSize == 0)
            throw new InvalidOperationException("Cannot upload empty file");

        _log.Info("baidu", $"Upload start: {fileName} ({fileSize} bytes) → {remotePath}");

        // 本地计算每块的 MD5 与真实长度。
        // 必须用 ReadAtLeastAsync 读满一块:FileStream.Read 允许短读,按短读结果切块会让
        // precreate 的 block_list 与实际上传内容不一致(create 阶段报错且难排查)。
        var blockList = new List<string>();
        var chunkLengths = new List<int>();
        var md5Buffer = new byte[ChunkSize];
        using (var fs = File.OpenRead(localPath))
        {
            while (true)
            {
                var n = await fs.ReadAtLeastAsync(md5Buffer, ChunkSize, throwOnEndOfStream: false, ct);
                if (n == 0) break;
                blockList.Add(Convert.ToHexStringLower(MD5.HashData(md5Buffer.AsSpan(0, n))));
                chunkLengths.Add(n);
            }
        }

        _log.Info("baidu", $"Upload: {blockList.Count} chunk(s), total {fileSize} bytes");

        // Step 1: Pre-create with block_list
        var precreate = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["path"] = remotePath,
            ["size"] = fileSize.ToString(),
            ["isdir"] = "0",
            ["autoinit"] = "1",
            ["rtype"] = "3",
            ["block_list"] = JsonSerializer.Serialize(blockList),
        });

        _log.Info("baidu", "Upload step 1/3: precreate...");
        string preBody;
        using (var preResp = await _http.PostAsync($"{ApiBase}/file?method=precreate&access_token={token}", precreate, ct))
            preBody = await ReadBodyAsync(preResp.Content, ct);
        using var preDoc = JsonDocument.Parse(preBody);

        if (!CheckBaiduError(preDoc.RootElement, "precreate", preBody))
            throw new InvalidOperationException($"Pre-create failed: {RedactSecrets(preBody[..Math.Min(200, preBody.Length)])}");

        if (!preDoc.RootElement.TryGetProperty("uploadid", out var uploadIdProp))
            throw new InvalidOperationException($"Pre-create missing uploadid: {RedactSecrets(preBody[..Math.Min(200, preBody.Length)])}");

        var uploadId = uploadIdProp.GetString()!;
        // 服务端已存在的分块(秒传/上次中断残留):跳过上传,直接用于 create
        var serverBlocks = ReadServerBlockList(preDoc.RootElement);
        _log.Info("baidu", $"Upload step 1/3 OK: uploadid={uploadId[..Math.Min(12, uploadId.Length)]}..., {serverBlocks.Count} chunk(s) already on server");

        // Step 2: Upload missing chunks via superfile2 (multipart/form-data, field name "file")
        var uploadedMd5s = new string[blockList.Count];
        var chunkBuffer = new byte[ChunkSize];
        var skipped = 0;

        using (var fs2 = File.OpenRead(localPath))
        {
            for (int i = 0; i < blockList.Count; i++)
            {
                var length = chunkLengths[i];
                var read = await fs2.ReadAtLeastAsync(chunkBuffer, length, throwOnEndOfStream: false, ct);
                if (read != length)
                    throw new InvalidOperationException($"Local file changed during upload: chunk {i} expected {length} bytes but read {read}");

                if (serverBlocks.Contains(blockList[i]))
                {
                    uploadedMd5s[i] = blockList[i];
                    skipped++;
                }
                else
                {
                    uploadedMd5s[i] = await UploadChunkAsync(chunkBuffer, length, i, blockList.Count, remotePath, uploadId, blockList[i], ct);
                }

                progress?.Report((int)((float)(i + 1) / blockList.Count * 100));
            }
        }

        _log.Info("baidu", $"Upload step 2/3 OK: {blockList.Count - skipped} chunk(s) uploaded, {skipped} skipped");

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

        string createBody;
        using (var createResp = await _http.PostAsync($"{ApiBase}/file?method=create&access_token={token}", create, ct))
            createBody = await ReadBodyAsync(createResp.Content, ct);
        using var createDoc = JsonDocument.Parse(createBody);

        if (!CheckBaiduError(createDoc.RootElement, "create", createBody))
            throw new InvalidOperationException($"Create file failed: {RedactSecrets(createBody[..Math.Min(200, createBody.Length)])}");

        _log.Info("baidu", $"Upload OK: {fileName} ({fileSize} bytes) → {remotePath}");
        return remotePath;
    }

    /// <summary>precreate 响应里的 block_list = 服务端已存在的分块 MD5(用于秒传/续传跳过)。</summary>
    private static HashSet<string> ReadServerBlockList(JsonElement precreateRoot)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (precreateRoot.TryGetProperty("block_list", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
                if (item.GetString() is { Length: > 0 } md5) set.Add(md5);
        }
        return set;
    }

    /// <summary>
    /// 上传单个分块,失败按指数退避重试。
    /// 每次尝试都重新取 token:CheckBaiduError 遇到 errno 6/111/-6 会重置缓存,
    /// 因此长时间上传途中 token 过期可以在下一次尝试自动恢复。
    /// </summary>
    private async Task<string> UploadChunkAsync(byte[] buffer, int length, int index, int total,
        string remotePath, string uploadId, string fallbackMd5, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var token = await GetAccessToken(ct);
                var uploadUrl = $"{UploadBase}?method=upload&access_token={token}&path={Uri.EscapeDataString(remotePath)}&type=tmpfile&uploadid={uploadId}&partseq={index}";

                using var multipart = new MultipartFormDataContent();
                var fileContent = new ByteArrayContent(buffer, 0, length);
                fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                multipart.Add(fileContent, "file", $"part_{index}");

                string body;
                using (var uploadResp = await _http.PostAsync(uploadUrl, multipart, ct))
                    body = await ReadBodyAsync(uploadResp.Content, ct);
                using var uploadDoc = JsonDocument.Parse(body);

                if (!CheckBaiduError(uploadDoc.RootElement, $"upload-chunk-{index}", body))
                    throw new InvalidOperationException($"Upload chunk {index}/{total} failed: {RedactSecrets(body[..Math.Min(200, body.Length)])}");

                // Use server-returned MD5, fall back to local MD5
                return uploadDoc.RootElement.TryGetProperty("md5", out var md5) && md5.GetString() is { Length: > 0 } serverMd5
                    ? serverMd5
                    : fallbackMd5;
            }
            catch (Exception ex) when (ex is not OperationCanceledException && attempt < MaxChunkAttempts)
            {
                var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1));
                _log.Warn("baidu", $"Upload chunk {index}/{total} attempt {attempt}/{MaxChunkAttempts} failed, retry in {delay.TotalSeconds:F0}s: {ex.Message}");
                await Task.Delay(delay, ct);
            }
        }
    }
}
