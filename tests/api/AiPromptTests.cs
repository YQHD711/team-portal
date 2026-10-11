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

    // ── P1-1：RAG 注入段（空结果必须显式声明"没检索到队内资料"） ──

    [Fact]
    public void RagInjection_EmptyContext_MandatesNoMaterialNotice()
    {
        var message = AiProxyService.RagInjectionFor("");

        Assert.Contains("没有检索到相关资料", message);
        Assert.Contains("知识库中未检索到相关队内资料", message);
        Assert.Contains("回答开头", message);
        Assert.Contains("不要编造", message);
    }

    [Fact]
    public void RagInjection_WithContext_KeepsRuleAndCarriesTheContext()
    {
        var message = AiProxyService.RagInjectionFor("来源：公共/a.md（相关度 0.90）\n正文");

        Assert.Contains("知识库参考资料", message);
        Assert.Contains("来源：公共/a.md", message);
        // 有资料但都不相关时也要声明（同一句话，避免两个分支口径不一致）
        Assert.Contains("知识库中未检索到相关队内资料", message);
        Assert.DoesNotContain("没有检索到相关资料", message);
    }

    // ── P1-2：学习库命中时按阶段顺序给路径 ──

    [Fact]
    public void RagInjection_WithContext_IncludesStudyPathRule()
    {
        var message = AiProxyService.RagInjectionFor("来源：工程部/学习库/_学习路径.md（相关度 3.20）\n阶段 1：工程基础");

        Assert.Contains("按阶段顺序", message);
        Assert.Contains("/study", message);
        // P1-1 的空结果规则不能被这次改动碰掉
        Assert.Contains("知识库中未检索到相关队内资料", message);
    }

    [Fact]
    public void RagInjection_EmptyContext_DoesNotClaimStudyData()
    {
        var message = AiProxyService.RagInjectionFor("");

        Assert.DoesNotContain("/study", message);
        Assert.Contains("没有检索到相关资料", message);
    }

    // ── task-14 B：实时查询结果与两种"空" ──

    [Fact]
    public void RagInjection_LiveOnly_DoesNotMandateNoMaterialNotice()
    {
        var live = LiveInventoryContext.Header + "\n- 碳纤维管：当前可用数量 7，库位 1030-A-1-01";

        var message = AiProxyService.RagInjectionFor("", live);

        Assert.Contains(LiveInventoryContext.Header, message);
        Assert.Contains("碳纤维管", message);
        Assert.Contains("当前值", message);
        Assert.Contains("严禁编造数量或货位", message);
        // KB 空但有实时数据：不能再要求模型声明"没检索到队内资料"
        Assert.DoesNotContain("知识库中未检索到相关队内资料", message);
        Assert.DoesNotContain("没有检索到相关资料", message);
    }

    [Fact]
    public void RagInjection_KbAndLive_KeepsBothAndTheKbRules()
    {
        var message = AiProxyService.RagInjectionFor("来源：公共/物料管理规范.md（相关度 0.9）", LiveInventoryContext.Header + "\n- 锂电池：当前可用数量 12");

        Assert.Contains("知识库参考资料", message);
        Assert.Contains("来源：公共/物料管理规范.md", message);
        Assert.Contains("知识库中未检索到相关队内资料", message);      // KB 规则还在（P1-1 回归）
        Assert.Contains(LiveInventoryContext.Header, message);
        Assert.Contains("锂电池", message);
        Assert.Contains("当前值", message);
    }

    [Fact]
    public void RagInjection_NeitherKbNorLive_KeepsP11Mandate()
    {
        var message = AiProxyService.RagInjectionFor("", null);

        Assert.Contains("没有检索到相关资料", message);
        Assert.Contains("知识库中未检索到相关队内资料", message);
        Assert.DoesNotContain(LiveInventoryContext.Header, message);
    }
}
