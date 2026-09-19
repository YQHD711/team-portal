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

    [Fact]
    public async Task UploadFile_NumericBlockListFromRealApi_DoesNotCrash()
    {
        // 回归：线上 precreate 的 block_list 是【数字】(分片序号，见百度网盘开放平台「预上传」文档)。
        // 旧代码用 item.GetString() 读它，抛
        // "The requested operation requires an element of type 'String', but the target element has type 'Number'"
        // → 整个系统备份上传失败并回退本地副本。
        const int chunkSize = 4 * 1024 * 1024;
        var path = TempFile(chunkSize + 10);
        var ctx = BaiduTestFactory.Create((url, _, _) =>
        {
            if (url.Contains("method=precreate", StringComparison.Ordinal))
                return FakeBaiduHandler.Json("{\"errno\":0,\"uploadid\":\"up-1\",\"block_list\":[0,1]}");
            if (url.Contains("method=upload", StringComparison.Ordinal))
                return FakeBaiduHandler.Json("{\"errno\":0,\"md5\":\"server-md5\"}");
            return FakeBaiduHandler.Json("{\"errno\":0}");
        });

        try
        {
            await ctx.Service.UploadFile(path, "/apps/team-portal/system/backups/x.bin");

            // 数字 block_list 的语义(待上传/已上传)在各接口版本间不一致，
            // 猜错会让 create 失败 → 保守策略是两块都传，保证 create 的 MD5 列表完整
            Assert.Equal(2, ctx.Handler.CountCalls("method=upload"));
            Assert.Equal(1, ctx.Handler.CountCalls("method=create"));
            var createBody = FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(ctx.Handler.IndexOfCall("method=create")), "block_list");
            using var doc = JsonDocument.Parse(createBody);
            Assert.Equal(2, doc.RootElement.GetArrayLength());
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task UploadFile_NumericUploadId_IsAccepted()
    {
        // uploadid 也可能以大整数返回，GetString() 同样会抛类型异常
        var path = TempFile(1024);
        var ctx = BaiduTestFactory.Create((url, _, _) =>
        {
            if (url.Contains("method=precreate", StringComparison.Ordinal))
                return FakeBaiduHandler.Json("{\"errno\":0,\"uploadid\":123456789012345}");
            if (url.Contains("method=upload", StringComparison.Ordinal))
                return FakeBaiduHandler.Json("{\"errno\":0,\"md5\":\"server-md5\"}");
            return FakeBaiduHandler.Json("{\"errno\":0}");
        });

        try
        {
            await ctx.Service.UploadFile(path, "/apps/team-portal/system/backups/x.bin");

            // 数字 uploadid 应原样回传给 create
            var uploadId = FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(ctx.Handler.IndexOfCall("method=create")), "uploadid");
            Assert.Equal("123456789012345", uploadId);
        }
        finally { File.Delete(path); }
    }
}

/// <summary>JSON 宽容读取：百度同一字段可能数字/字符串混返，两种都必须能读出来。</summary>
public class BaiduJsonTypeToleranceTests
{
    [Theory]
    [InlineData("123456789012345", "123456789012345")]   // 大整数 uploadid
    [InlineData("\"up-1\"", "up-1")]
    [InlineData("0", "0")]
    [InlineData("\"\"", "")]
    [InlineData("null", null)]
    [InlineData("true", null)]
    public void JsonStringOrNumber_ReadsStringAndNumber(string json, string? expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, BaiduNetdiskService.JsonStringOrNumber(doc.RootElement));
    }

    [Theory]
    [InlineData("0", 0)]
    [InlineData("17", 17)]
    [InlineData("-6", -6)]
    [InlineData("\"17\"", 17)]                            // errno 为数字字符串
    [InlineData("\"abc\"", null)]
    [InlineData("null", null)]
    public void JsonIntOrString_ReadsStringAndNumber(string json, int? expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, BaiduNetdiskService.JsonIntOrString(doc.RootElement));
    }
}
