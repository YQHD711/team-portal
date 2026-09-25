using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 知识库图片上传的文件名净化。
///
/// 上传得到的文件名会直接拼进知识库相对路径（`{dir}/{stem}{ext}`），
/// 所以它必须挡住目录分隔符与 `..` —— 否则 `../../../x.png` 这类名字能把文件
/// 写到知识库之外（UploadAndProcess 那条路有同样的历史教训）。
/// </summary>
public class KnowledgeAssetTests
{
    [Theory]
    [InlineData("示意图.png", "示意图")]
    [InlineData("figure-1.png", "figure-1")]
    [InlineData("a_b c.png", "a_b-c")]
    [InlineData("../../evil.png", "evil")]              // 目录部分被去掉
    [InlineData("..\\..\\windows\\evil.png", "evil")]   // 反斜杠同样处理
    [InlineData("/etc/passwd.png", "passwd")]
    public void SanitizeStem_StripsPathsAndKeepsReadableName(string input, string expected)
    {
        Assert.Equal(expected, AdminEndpoints.SanitizeStem(input));
    }

    [Theory]
    [InlineData("..")]
    [InlineData("...")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("../../")]
    [InlineData("***.png")]     // 全是非法字符
    [InlineData(null)]
    public void SanitizeStem_FallsBackInsteadOfProducingEmptyOrDots(string? input)
    {
        var stem = AdminEndpoints.SanitizeStem(input);

        Assert.Equal("image", stem);
        Assert.DoesNotContain("..", stem);
        Assert.DoesNotContain("/", stem);
    }

    [Fact]
    public void SanitizeStem_TruncatesLongNames()
    {
        var stem = AdminEndpoints.SanitizeStem(new string('a', 200) + ".png");

        Assert.Equal(60, stem.Length);
    }

    [Fact]
    public void SanitizeStem_NeverLeavesPathSeparators()
    {
        foreach (var raw in new[] { "a/b.png", "a\\b.png", "..%2f..%2fx.png", "a\u0000b.png" })
        {
            var stem = AdminEndpoints.SanitizeStem(raw);
            Assert.DoesNotContain("/", stem);
            Assert.DoesNotContain("\\", stem);
        }
    }
}
