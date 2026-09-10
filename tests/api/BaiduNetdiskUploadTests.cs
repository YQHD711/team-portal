using System.Security.Cryptography;
using System.Text.Json;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 百度网盘上传测试 —— 覆盖分片重试、中途 token 过期刷新、秒传/续传跳过已存在分块。
/// </summary>
public class BaiduNetdiskUploadTests
{
    private const string PrecreateOk = "{\"errno\":0,\"uploadid\":\"up-1\"}";

    private static string TempFile(int size)
    {
        var path = Path.Combine(Path.GetTempPath(), $"baidu-upload-{Guid.NewGuid():N}.bin");
        File.WriteAllBytes(path, new byte[size]);
        return path;
    }

    [Fact]
    public async Task UploadFile_RetriesFailedChunk()
    {
        var path = TempFile(1024);
        var attempts = 0;
        var ctx = BaiduTestFactory.Create((url, _, _) =>
        {
            if (url.Contains("method=precreate", StringComparison.Ordinal)) return FakeBaiduHandler.Json(PrecreateOk);
            if (url.Contains("method=upload", StringComparison.Ordinal))
                return ++attempts == 1
                    ? FakeBaiduHandler.Json("{\"errno\":-7,\"request_id\":1}")
                    : FakeBaiduHandler.Json("{\"errno\":0,\"md5\":\"server-md5\"}");
            return FakeBaiduHandler.Json("{\"errno\":0}");
        });

        try
        {
            await ctx.Service.UploadFile(path, "/apps/team-portal/system/backups/x.bin");

            Assert.Equal(2, attempts); // 第 1 次失败后重试成功
            Assert.Equal(1, ctx.Handler.CountCalls("method=create"));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task UploadFile_ExpiredTokenMidway_RefreshesAndRetries()
    {
        var path = TempFile(1024);
        var uploadAttempts = 0;
        var ctx = BaiduTestFactory.Create((url, _, _) =>
        {
            if (url.Contains("method=precreate", StringComparison.Ordinal)) return FakeBaiduHandler.Json(PrecreateOk);
            if (url.Contains("method=upload", StringComparison.Ordinal))
                return ++uploadAttempts == 1
                    ? FakeBaiduHandler.Json("{\"errno\":6,\"request_id\":1}")   // token 过期
                    : FakeBaiduHandler.Json("{\"errno\":0,\"md5\":\"server-md5\"}");
            return FakeBaiduHandler.Json("{\"errno\":0}");
        });
        var refreshBefore = ctx.Handler.CountCalls("grant_type=refresh_token");

        try
        {
            await ctx.Service.UploadFile(path, "/apps/team-portal/x.bin");

            // errno=6 会重置缓存的 token,重试时必须重新取到新 token
            Assert.True(ctx.Handler.CountCalls("grant_type=refresh_token") > refreshBefore);
            Assert.Equal(2, uploadAttempts);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task UploadFile_SkipsChunksAlreadyOnServer()
    {
        // precreate 的 block_list 表示服务端已存在的分块(秒传/上次中断残留),这些块不应再上传
        const int chunkSize = 4 * 1024 * 1024;
        var path = TempFile(chunkSize + 10);
        var firstChunkMd5 = Convert.ToHexStringLower(MD5.HashData(new byte[chunkSize]));
        var ctx = BaiduTestFactory.Create((url, _, _) =>
        {
            if (url.Contains("method=precreate", StringComparison.Ordinal))
                return FakeBaiduHandler.Json($"{{\"errno\":0,\"uploadid\":\"up-1\",\"block_list\":[\"{firstChunkMd5}\"]}}");
            if (url.Contains("method=upload", StringComparison.Ordinal))
                return FakeBaiduHandler.Json("{\"errno\":0,\"md5\":\"server-md5\"}");
            return FakeBaiduHandler.Json("{\"errno\":0}");
        });

        try
        {
            await ctx.Service.UploadFile(path, "/apps/team-portal/system/backups/x.bin");

            Assert.Equal(1, ctx.Handler.CountCalls("method=upload")); // 第 0 块被跳过,只传第 1 块
            var createBody = FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(ctx.Handler.IndexOfCall("method=create")), "block_list");
            using var doc = JsonDocument.Parse(createBody);
            Assert.Equal(2, doc.RootElement.GetArrayLength()); // create 仍需按原顺序给出全部块
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task UploadFile_ChunkBoundariesMatchPrecreateBlockList()
    {
        // 两趟读取(算 MD5 / 传分片)必须切出一致的块边界,否则 create 会因 block_list 不符而失败
        const int chunkSize = 4 * 1024 * 1024;
        var path = TempFile(chunkSize + 10);
        var ctx = BaiduTestFactory.Create((url, _, _) => url.Contains("method=precreate", StringComparison.Ordinal)
            ? FakeBaiduHandler.Json(PrecreateOk)
            : FakeBaiduHandler.Json("{\"errno\":0,\"md5\":\"server-md5\"}"));

        try
        {
            await ctx.Service.UploadFile(path, "/apps/team-portal/x.bin");

            var precreateList = JsonDocument.Parse(
                FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(ctx.Handler.IndexOfCall("method=precreate")), "block_list")).RootElement;
            var createList = JsonDocument.Parse(
                FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(ctx.Handler.IndexOfCall("method=create")), "block_list")).RootElement;

            Assert.Equal(2, precreateList.GetArrayLength());  // 4MB + 10B → 2 块
            Assert.Equal(2, createList.GetArrayLength());
            Assert.Equal(1, ctx.Handler.CountCalls("partseq=0"));
            Assert.Equal(1, ctx.Handler.CountCalls("partseq=1"));
        }
        finally { File.Delete(path); }
    }
}
