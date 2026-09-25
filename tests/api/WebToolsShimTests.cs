using TeamPortal.Middleware;

namespace api;

/// <summary>
/// WebTools 目录选择兜底脚本的注入。
///
/// 关键约束：<c>window.showDirectoryPicker</c> 是 SecureContext 特性，按 IP + http 直连时浏览器
/// 根本不暴露它，LogFinder 一点「搜索目录」就报「此浏览器不支持打开目录」。这里的注入必须满足：
/// 1) 原生 API 存在时立刻返回（配上域名走 HTTPS 后自动失效，不能把原生的盖掉）；
/// 2) 只提供只读接口，不伪造任何写能力；
/// 3) 幂等 —— 重复注入不会出现两段脚本。
/// </summary>
public class WebToolsShimTests
{
    [Fact]
    public void Inject_InsertsScriptRightAfterHeadOpen()
    {
        var html = "<!DOCTYPE html><html><head><title>t</title></head><body></body></html>";
        var result = WebToolsDirPickerShim.Inject(html);

        Assert.Contains(WebToolsDirPickerShim.Marker, result);
        // 必须在 <head> 之后、页面自身脚本之前定义，否则页面可能先做特性检测
        var headEnd = result.IndexOf("</head>", StringComparison.Ordinal);
        var markerAt = result.IndexOf(WebToolsDirPickerShim.Marker, StringComparison.Ordinal);
        Assert.True(markerAt > result.IndexOf("<head>", StringComparison.Ordinal));
        Assert.True(markerAt < headEnd);
    }

    [Fact]
    public void Inject_IsIdempotent()
    {
        var once = WebToolsDirPickerShim.Inject("<html><head></head><body></body></html>");
        var twice = WebToolsDirPickerShim.Inject(once);

        Assert.Equal(once, twice);
        Assert.Equal(1, CountOccurrences(twice, WebToolsDirPickerShim.Marker));
    }

    [Fact]
    public void Inject_FallsBackToBodyCloseWhenNoHead()
    {
        var result = WebToolsDirPickerShim.Inject("<html><body>hi</body></html>");

        Assert.Contains(WebToolsDirPickerShim.Marker, result);
        Assert.True(result.IndexOf(WebToolsDirPickerShim.Marker, StringComparison.Ordinal)
                    < result.IndexOf("</body>", StringComparison.Ordinal));
    }

    [Fact]
    public void Inject_AppendsWhenHtmlHasNeitherHeadNorBody()
    {
        var result = WebToolsDirPickerShim.Inject("<h1>裸片段</h1>");
        Assert.EndsWith(WebToolsDirPickerShim.Script, result);
    }

    [Theory]
    [InlineData("")]
    public void Inject_LeavesEmptyInputAlone(string html)
    {
        Assert.Equal(html, WebToolsDirPickerShim.Inject(html));
    }

    /// <summary>原生 API 可用时必须原地返回 —— 将来配上域名走 HTTPS，兜底要自动失效。</summary>
    [Fact]
    public void Script_DisablesItselfWhenNativePickerExists()
    {
        Assert.Contains("typeof window.showDirectoryPicker === \"function\") return", WebToolsDirPickerShim.Script);
    }

    /// <summary>LogFinder 实际用到的接口一个都不能少（name / kind / values / getFile）。</summary>
    [Theory]
    [InlineData("kind: \"file\"")]
    [InlineData("kind: \"directory\"")]
    [InlineData("getFile:")]
    [InlineData("values:")]
    [InlineData("webkitdirectory")]
    [InlineData("input.click()")]
    public void Script_ImplementsTheSurfaceLogFinderUses(string fragment)
    {
        Assert.Contains(fragment, WebToolsDirPickerShim.Script);
    }

    /// <summary>用户取消要和原生一样抛 AbortError，调用方的 .catch() 才能照常工作。</summary>
    [Fact]
    public void Script_RejectsWithAbortErrorOnCancel()
    {
        Assert.Contains("AbortError", WebToolsDirPickerShim.Script);
        Assert.Contains("addEventListener(\"cancel\"", WebToolsDirPickerShim.Script);
    }

    /// <summary>兜底只给读：绝不伪造 createWritable / removeEntry 这类写能力。</summary>
    [Theory]
    [InlineData("createWritable")]
    [InlineData("removeEntry")]
    [InlineData("showSaveFilePicker")]
    public void Script_FakesNoWriteCapability(string forbidden)
    {
        Assert.DoesNotContain(forbidden, WebToolsDirPickerShim.Script);
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var at = 0;
        while ((at = haystack.IndexOf(needle, at, StringComparison.Ordinal)) >= 0)
        {
            count++;
            at += needle.Length;
        }
        return count;
    }
}
