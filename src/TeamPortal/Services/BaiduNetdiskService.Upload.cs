using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// BaiduNetdiskService 的上传部分：本地文件分块（4MB）上传，precreate → 逐块 upload → create 三步流程。
/// </summary>
public partial class BaiduNetdiskService
{
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
}
