using System.Text.Json;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 百度网盘文件接口测试 —— 覆盖 P0：ListFiles 分页、filelist JSON 转义、OAuth 响应体脱敏。
/// </summary>
public class BaiduNetdiskFilesTests
{
    private static string FileJson(string path, long fsId)
        => $"{{\"fs_id\":{fsId},\"path\":\"{path}\",\"server_filename\":\"{Path.GetFileName(path)}\",\"size\":10,\"isdir\":0,\"server_mtime\":1}}";

    [Fact]
    public async Task ListFiles_PaginatesUntilShortPage()
    {
        // 百度单次最多 1000 条且不自动翻页:旧实现固定 limit=1000 会丢掉第 1001 条之后
        var page1 = string.Join(",", Enumerable.Range(0, 1000).Select(i => FileJson($"/d/f{i}", 1000 + i)));
        var page2 = string.Join(",", Enumerable.Range(1000, 3).Select(i => FileJson($"/d/f{i}", 1000 + i)));
        var ctx = BaiduTestFactory.Create((_, _, call) => FakeBaiduHandler.Json(
            call == 0 ? $"{{\"errno\":0,\"list\":[{page1}]}}" : $"{{\"errno\":0,\"list\":[{page2}]}}"));

        var files = await ctx.Service.ListFiles("/d");

        Assert.Equal(1003, files.Count);
        Assert.Equal(2, ctx.Handler.CountCalls("method=list"));
        Assert.Contains("start=0", ctx.Handler.Urls[0]);
        Assert.Contains("start=1000", ctx.Handler.Urls[1]);
        Assert.Equal("/d/f1002", files[^1].Path);
    }

    [Fact]
    public async Task ListFiles_StopsWhenPageNotFull()
    {
        var ctx = BaiduTestFactory.Create((_, _, _) => FakeBaiduHandler.Json(
            "{\"errno\":0,\"list\":[" + FileJson("/d/only", 1) + "]}"));

        var files = await ctx.Service.ListFiles("/d");

        Assert.Single(files);
        Assert.Equal(1, ctx.Handler.CountCalls("method=list")); // 不满一页即停,不再多发请求
    }

    [Fact]
    public async Task DeleteFile_SerializesPathInsteadOfConcatenating()
    {
        // 旧实现 $"[{{\"path\":\"{remotePath}\"}}]" 遇到引号/反斜杠会产出非法 JSON
        const string trickyPath = "/apps/team-portal/a\"b\\c";
        var ctx = BaiduTestFactory.Create((_, _, _) => FakeBaiduHandler.Json("{\"errno\":0}"));

        var ok = await ctx.Service.DeleteFile(trickyPath);

        Assert.True(ok);
        var fileList = FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(0), "filelist");
        using var doc = JsonDocument.Parse(fileList);
        Assert.Equal(trickyPath, doc.RootElement[0].GetProperty("path").GetString());
    }

    [Fact]
    public async Task CreateDirectory_SerializesPathInsteadOfConcatenating()
    {
        const string trickyPath = "/apps/team-portal/x\"},{\"path\":\"/apps/team-portal/y";
        var ctx = BaiduTestFactory.Create((_, _, _) => FakeBaiduHandler.Json("{\"errno\":0}"));

        var ok = await ctx.Service.CreateDirectory(trickyPath);

        Assert.True(ok);
        var fileList = FakeBaiduHandler.FormField(ctx.Handler.BodyOfCall(0), "filelist");
        using var doc = JsonDocument.Parse(fileList);
        // 注入额外路径的构造必须无法生效:数组里只有一项
        Assert.Equal(1, doc.RootElement.GetArrayLength());
        Assert.Equal(trickyPath, doc.RootElement[0].GetProperty("path").GetString());
    }

    [Fact]
    public void RedactSecrets_MasksTokenValues()
    {
        var json = BaiduNetdiskService.RedactSecrets(
            "{\"access_token\":\"abc123\",\"refresh_token\":\"def456\",\"scope\":\"basic\"}");

        Assert.DoesNotContain("abc123", json);
        Assert.DoesNotContain("def456", json);
        Assert.Contains("***", json);
        Assert.Contains("basic", json);

        var query = BaiduNetdiskService.RedactSecrets("https://x/y?access_token=abc123&z=1");
        Assert.DoesNotContain("abc123", query);
        Assert.Contains("z=1", query);
    }

    [Fact]
    public async Task ExchangeCode_TokenInResponse_NotWrittenToLogsOrException()
    {
        // OAuth 交换响应体含 access_token,既不能落日志也不能出现在异常里
        const string leaked = "leaked-access-token-value";
        var ctx = BaiduTestFactory.Create((_, _, _) => FakeBaiduHandler.Json(
            $"{{\"access_token\":\"{leaked}\",\"refresh_token\":\"rt\",\"expires_in\":3600,\"scope\":\"basic\"}}"));

        var message = await ctx.Service.ExchangeCode("some-code");

        Assert.Contains("授权成功", message);
        Assert.DoesNotContain(leaked, string.Join("\n", ctx.Logger.Messages));
    }

    [Fact]
    public async Task ExchangeCode_NonJsonResponse_RedactsTokenInException()
    {
        const string leaked = "leaked-access-token-value";
        var ctx = BaiduTestFactory.Create((_, _, _) => FakeBaiduHandler.Json($"not-json access_token={leaked}"));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => ctx.Service.ExchangeCode("bad-code"));

        Assert.DoesNotContain(leaked, ex.Message);
    }
}
