using TeamPortal.Services;

namespace api;

/// <summary>
/// AI 助手提示词：前端是纯文本渲染（whitespace-pre-wrap），所以系统提示词必须明确要求模型
/// 不要输出 Markdown 装饰与 emoji；同时管理员可以整体替换提示词。
/// 回归背景：旧提示词自己写着「## 回答格式」「用 📄 标注来源」，把装饰符号教给了模型。
/// </summary>
public class AiPromptTests
{
    [Fact]
    public void DefaultPrompt_RequiresPlainText_AndCarriesNoDecorationsItself()
    {
        var prompt = AiProxyService.DefaultSystemPrompt;

        Assert.Contains("纯文本", prompt);
        Assert.Contains("emoji", prompt);
        // 提示词自己不能带装饰符号，否则等于在给模型做示范
        Assert.DoesNotContain("**", prompt);
        Assert.DoesNotContain("##", prompt);
        Assert.DoesNotContain("---", prompt);
        Assert.DoesNotContain("📄", prompt);
        Assert.DoesNotContain("⚠", prompt);
    }

    [Fact]
    public void DefaultPrompt_KeepsKnowledgeBaseRules()
    {
        var prompt = AiProxyService.DefaultSystemPrompt;

        // 队内知识库优先 + 通用知识需注明，这两条是产品底线，重写文案时不能弄丢
        Assert.Contains("来源：", prompt);
        Assert.Contains("以下信息来自通用知识", prompt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n  ")]
    public void SystemPromptOrDefault_BlankFallsBackToBuiltInDefault(string? configured)
        => Assert.Equal(AiProxyService.DefaultSystemPrompt, AiProxyService.SystemPromptOrDefault(configured));

    [Fact]
    public void SystemPromptOrDefault_UsesConfiguredPrompt()
    {
        var resolved = AiProxyService.SystemPromptOrDefault("  你是我的自定义助手  ");

        Assert.Equal("你是我的自定义助手", resolved); // 首尾空白会被去掉
        Assert.DoesNotContain("雏鹰之翼", resolved);
    }

    [Fact]
    public void BuildContext_HasNoEmojiOrSeparators()
    {
        var context = AiProxyService.BuildContext(
        [
            new KbResult { Path = "公共/ardupilot/installation.md", Snippet = "安装步骤", Score = 0.87 },
            new KbResult { Path = "公共/egoplanner/realsense.md", Snippet = "相机接入", Score = 0.42 },
        ]);

        Assert.DoesNotContain("📄", context);
        Assert.DoesNotContain("---", context);
        Assert.DoesNotContain("**", context);
        Assert.DoesNotContain("##", context);
        // 来源与相关度仍然要能看见（模型据此标注出处）
        Assert.Contains("来源：公共/ardupilot/installation.md", context);
        Assert.Contains("0.87", context);
    }

    [Fact]
    public void BuildContext_EmptySources_ReturnsEmpty() => Assert.Equal("", AiProxyService.BuildContext([]));
}
