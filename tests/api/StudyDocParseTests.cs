using TeamPortal.Services;

namespace api;

/// <summary>
/// 「_学习路径.md」/「_阶段说明.md」的可选 front matter 解析。
/// 卡片上的「时长 / 目标」靠它，但写不写都不影响正文渲染 —— 没写就整篇当正文。
/// </summary>
public class StudyDocParseTests
{
    [Fact]
    public void NoFrontMatter_BodyIsRawText()
    {
        var (meta, body) = StudyLibraryService.ParseDoc("# 标题\n\n正文");

        Assert.Empty(meta);
        Assert.Equal("# 标题\n\n正文", body);
    }

    [Fact]
    public void FrontMatter_ExtractedAndStrippedFromBody()
    {
        const string raw = "---\n时长: 2-3 周\n目标: 掌握环境搭建\n---\n\n## 阶段目标\n\n- 装好工具链";

        var (meta, body) = StudyLibraryService.ParseDoc(raw);

        Assert.Equal("2-3 周", StudyLibraryService.MetaValue(meta, "时长", "duration"));
        Assert.Equal("掌握环境搭建", StudyLibraryService.MetaValue(meta, "目标", "goal"));
        Assert.StartsWith("## 阶段目标", body);
        Assert.DoesNotContain("时长", body);   // 元信息不能重复出现在正文里
    }

    [Fact]
    public void EnglishKeys_AlsoRecognized()
    {
        var (meta, _) = StudyLibraryService.ParseDoc("---\nduration: 3 weeks\ngoal: build tools\n---\nbody");

        Assert.Equal("3 weeks", StudyLibraryService.MetaValue(meta, "时长", "duration"));
        Assert.Equal("build tools", StudyLibraryService.MetaValue(meta, "目标", "goal"));
    }

    [Fact]
    public void UnclosedFrontMatter_KeptAsBody()
    {
        // 只写了开头 --- 的情况：绝不能把整篇吃掉（否则用户会觉得"文档突然空白"）
        var (meta, body) = StudyLibraryService.ParseDoc("---\n时长: 1 周\n\n正文还在");

        Assert.Empty(meta);
        Assert.Contains("正文还在", body);
    }

    [Fact]
    public void CrlfFrontMatter_StillParsed()
    {
        var (meta, body) = StudyLibraryService.ParseDoc("---\r\n时长: 1 周\r\n---\r\n正文");

        Assert.Equal("1 周", meta["时长"]);
        Assert.Equal("正文", body);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyInput_ReturnsEmpty(string? raw)
    {
        var (meta, body) = StudyLibraryService.ParseDoc(raw);

        Assert.Empty(meta);
        Assert.Equal("", body);
    }

    [Fact]
    public void MetaValue_IgnoresBlankValues()
    {
        var meta = new Dictionary<string, string> { ["时长"] = "   " };

        Assert.Null(StudyLibraryService.MetaValue(meta, "时长", "duration"));
    }
}
