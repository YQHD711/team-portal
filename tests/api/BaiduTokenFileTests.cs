using TeamPortal.Services;

namespace api;

/// <summary>
/// 百度网盘凭据文件（data/baidu-token.json）的读取契约。
///
/// 线上故障：文件里 refresh_token 是**数字**（或文件被写坏）时，旧代码直接
/// <c>rt.GetString()</c> 抛 "The requested operation requires an element of type 'String',
/// but the target element has type 'Number'"，异常一路冒到 BackupSystem 的兜底 catch，
/// 被记成「Backup upload failed, keeping local copy: ...」——把人引到上传环节，
/// 实际只需要重新授权。这里的契约是：
/// 1) 任何形态的坏文件都**不抛异常**，只返回 null + 可读原因；
/// 2) 坏文件改名 .corrupt-* 留存现场，不删除（下次还能查）；
/// 3) 正常文件原样读出，且不做任何改动。
/// </summary>
public class BaiduTokenFileTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "baidu-token-" + Guid.NewGuid().ToString("N")[..8]);

    public BaiduTokenFileTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { /* 测试清理尽力而为 */ }
    }

    private string WriteTokenFile(string content)
    {
        var path = Path.Combine(_dir, "baidu-token.json");
        File.WriteAllText(path, content);
        return path;
    }

    private string[] CorruptFiles() => Directory.GetFiles(_dir, "*.corrupt-*");

    [Fact]
    public void StringToken_IsReturnedAsIs()
    {
        var path = WriteTokenFile("{\"refresh_token\":\"abc-123\"}");

        var token = BaiduNetdiskService.ReadStoredRefreshToken(path, out var problem);

        Assert.Equal("abc-123", token);
        Assert.Null(problem);
        Assert.True(File.Exists(path));           // 好文件不许动
        Assert.Empty(CorruptFiles());
    }

    /// <summary>回归测试：数字型 refresh_token 曾让系统备份在「上传」环节报类型异常。</summary>
    [Fact]
    public void NumericToken_DoesNotThrow()
    {
        var path = WriteTokenFile("{\"refresh_token\":123456789}");

        var token = BaiduNetdiskService.ReadStoredRefreshToken(path, out var problem);

        Assert.Equal("123456789", token);
        Assert.Null(problem);
        Assert.Empty(CorruptFiles());
    }

    [Fact]
    public void MissingFile_ReturnsNullWithoutProblem()
    {
        var token = BaiduNetdiskService.ReadStoredRefreshToken(Path.Combine(_dir, "nope.json"), out var problem);

        Assert.Null(token);
        Assert.Null(problem);   // 「从没授权过」不是异常情况，不该刷警告
    }

    [Theory]
    [InlineData("{\"access_token\":\"only-access\"}")]   // 缺字段
    [InlineData("{\"refresh_token\":\"\"}")]             // 空值
    [InlineData("{\"refresh_token\":null}")]             // null
    [InlineData("{\"refresh_token\":{\"a\":1}}")]        // 对象（类型无法识别）
    [InlineData("this is not json")]                     // 非 JSON
    [InlineData("[]")]                                   // 非对象
    [InlineData("")]
    public void UnusableFile_ReturnsNullAndQuarantinesInsteadOfThrowing(string content)
    {
        var path = WriteTokenFile(content);

        var token = BaiduNetdiskService.ReadStoredRefreshToken(path, out var problem);

        Assert.Null(token);
        Assert.False(string.IsNullOrWhiteSpace(problem));
        Assert.False(File.Exists(path));                     // 已隔离
        var quarantined = Assert.Single(CorruptFiles());
        Assert.Equal(content, File.ReadAllText(quarantined)); // 现场保留，便于事后排查
    }

    [Fact]
    public void QuarantinedFile_IsNotReadAgain()
    {
        var path = WriteTokenFile("{\"refresh_token\":false}");

        BaiduNetdiskService.ReadStoredRefreshToken(path, out _);
        var second = BaiduNetdiskService.ReadStoredRefreshToken(path, out var secondProblem);

        // 第二次是「文件不存在」的安静路径，不会再报一次损坏
        Assert.Null(second);
        Assert.Null(secondProblem);
    }

    /// <summary>
    /// 记录旧实现的失败方式：对数字元素直接 GetString() 抛的就是线上那条消息。
    /// 这条断言钉住「为什么不能用 GetString()」，改坏了会立刻红。
    /// </summary>
    [Fact]
    public void OldImplementation_ThrewTheProductionMessage()
    {
        using var doc = System.Text.Json.JsonDocument.Parse("{\"refresh_token\":123456789}");
        var el = doc.RootElement.GetProperty("refresh_token");

        var ex = Assert.Throws<InvalidOperationException>(() => el.GetString());

        Assert.Contains("requires an element of type 'String'", ex.Message);
        Assert.Contains("has type 'Number'", ex.Message);
    }
}
