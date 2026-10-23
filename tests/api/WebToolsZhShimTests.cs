using TeamPortal.Middleware;

namespace api;

/// <summary>
/// WebTools 中文补充脚本：必须幂等注入、优先 head、并且词典只做**精确匹配**（不动数字/参数/URL）。
/// </summary>
public class WebToolsZhShimTests
{
    [Fact]
    public void Inject_InsertsScriptAfterHead()
    {
        var result = WebToolsZhShim.Inject("<!DOCTYPE html><html><head><title>t</title></head><body><h1>Setup</h1></body></html>");
        Assert.Contains(WebToolsZhShim.Marker, result);
        var markerAt = result.IndexOf(WebToolsZhShim.Marker, StringComparison.Ordinal);
        Assert.True(markerAt > result.IndexOf("<head>", StringComparison.Ordinal));
        Assert.True(markerAt < result.IndexOf("</head>", StringComparison.Ordinal));
    }

    [Fact]
    public void Inject_IsIdempotent()
    {
        var once = WebToolsZhShim.Inject("<html><head></head><body></body></html>");
        var twice = WebToolsZhShim.Inject(once);
        Assert.Equal(once, twice);
    }

    [Fact]
    public void Inject_FallsBackToBodyClose()
    {
        var result = WebToolsZhShim.Inject("<html><body>hi</body></html>");
        Assert.True(result.IndexOf(WebToolsZhShim.Marker, StringComparison.Ordinal)
                    < result.IndexOf("</body>", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("\"Setup\":\"设置\"")]
    [InlineData("\"Analysis time\":\"分析时间\"")]
    [InlineData("\"Velocity source\":\"速度来源\"")]
    [InlineData("\"Hit Calculate to see results.\":\"点击「计算」查看结果。\"")]
    public void Script_ContainsKeyTranslations(string fragment)
    {
        Assert.Contains(fragment, WebToolsZhShim.Script);
    }

    /// <summary>单字母/数字/纯标识符不能进词典：否则会误翻 P、I、D、X 这类参数名。</summary>
    [Theory]
    [InlineData("\"I\":")]
    [InlineData("\"P\":")]
    [InlineData("\"D\":")]
    [InlineData("\"X\":")]
    public void Dictionary_DoesNotContainSingleLetterKeys(string forbidden)
    {
        Assert.DoesNotContain(forbidden, WebToolsZhShim.DictionaryJson);
    }

    [Fact]
    public void Script_SkipsCodeAndScriptNodes()
    {
        Assert.Contains("SCRIPT: 1", WebToolsZhShim.Script);
        Assert.Contains("PRE: 1", WebToolsZhShim.Script);
        Assert.Contains("TEXTAREA: 1", WebToolsZhShim.Script);
    }
}