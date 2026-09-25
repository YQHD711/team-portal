using System.Text.Json;
using TeamPortal.Services;

namespace api;

/// <summary>
/// AI 系统管理员 = **只读**运维助手。这些测试锁死它的能力边界：
/// 1) 工具集恰好是那 9 个只读工具 —— 代码提案（propose_improvement/list_proposals）、
///    代码检索（read_file/analyze_code/read_db_schema）、编译重启都不允许再出现；
/// 2) 提示词里工具清单与注册表同源，不会「写着某个工具其实没注册」；
/// 3) 设置读取必须脱敏，否则助手会把 AI:DeepSeekKey 明文念出来并写进会话记忆。
/// </summary>
public class SystemAgentAssistantTests
{
    /// <summary>有写语义的动词前缀：出现在工具名里就说明只读边界被破坏。</summary>
    private static readonly string[] WriteVerbs =
        ["propose", "write", "apply", "rebuild", "restart", "rollback", "delete", "update", "create", "execute"];

    private static readonly string[] ExpectedTools =
    [
        "get_system_health", "get_system_stats", "read_logs", "list_backups",
        "get_settings", "knowledge_overview", "search_knowledge", "team_overview", "get_admin_guide"
    ];

    private static JsonElement Schema(ToolDef t) => JsonSerializer.SerializeToElement(t.Parameters);

    private static string[] Required(ToolDef t)
        => Schema(t).GetProperty("required").EnumerateArray().Select(e => e.GetString()!).ToArray();

    // ── 工具集 ──────────────────────────────────────────────

    [Fact]
    public void Tools_AreExactlyTheReadOnlyAssistantSet()
    {
        var names = SystemAgentService.BuildTools().Select(t => t.Name).ToArray();
        Assert.Equal(ExpectedTools, names);
    }

    [Fact]
    public void Tools_ContainNoWriteCapableVerb()
    {
        foreach (var tool in SystemAgentService.BuildTools())
        {
            var verb = tool.Name.Split('_')[0];
            Assert.DoesNotContain(verb, WriteVerbs);
        }
    }

    [Fact]
    public void Tools_RemovedCodeProposalTooling_IsGone()
    {
        var names = SystemAgentService.BuildTools().Select(t => t.Name).ToList();
        Assert.DoesNotContain("propose_improvement", names);
        Assert.DoesNotContain("list_proposals", names);
        // 改代码用的源码检索工具一并下线（容器里只有 publish 产物，本来也读不到源码）
        Assert.DoesNotContain("read_file", names);
        Assert.DoesNotContain("analyze_code", names);
        Assert.DoesNotContain("read_db_schema", names);
        Assert.DoesNotContain("list_files", names);
    }

    [Fact]
    public void Tools_EveryToolHasDescription()
    {
        foreach (var tool in SystemAgentService.BuildTools())
            Assert.False(string.IsNullOrWhiteSpace(tool.Description), $"{tool.Name} 缺少描述");
    }

    // ── 可选参数不能被标成必填 ──────────────────────────────

    [Fact]
    public void Tools_OptionalParametersAreNotRequired()
    {
        var tools = SystemAgentService.BuildTools().ToDictionary(t => t.Name);
        Assert.Empty(Required(tools["read_logs"]));
        Assert.Empty(Required(tools["get_settings"]));
        Assert.Empty(Required(tools["get_admin_guide"]));
        Assert.Empty(Required(tools["get_system_health"]));
        Assert.Equal(["query"], Required(tools["search_knowledge"]));
    }

    [Fact]
    public void ToolDef_LegacyConstructor_MarksAllParametersRequired()
    {
        var tool = new ToolDef("demo", "d", new { a = new { type = "string" }, b = new { type = "integer" } });
        Assert.Equal(["a", "b"], Required(tool));
    }

    [Fact]
    public void ToolDef_ExplicitRequired_OnlyMarksListedParameters()
    {
        var tool = new ToolDef("demo", "d", new { a = new { type = "string" }, b = new { type = "integer" } }, ["a"]);
        Assert.Equal(["a"], Required(tool));
        // 可选参数仍要留在 properties 里，否则模型看不见它
        Assert.True(Schema(tool).GetProperty("properties").TryGetProperty("b", out _));
    }

    // ── 提示词 ──────────────────────────────────────────────

    [Fact]
    public void SystemPrompt_ListsEveryRegisteredTool()
    {
        var prompt = SystemAgentService.BuildSystemPrompt();
        foreach (var tool in SystemAgentService.BuildTools())
            Assert.Contains(tool.Name, prompt);
    }

    [Fact]
    public void SystemPrompt_StatesReadOnlyAndNoCodeChangeBoundary()
    {
        var prompt = SystemAgentService.BuildSystemPrompt();
        Assert.Contains("只读", prompt);
        Assert.Contains("不写代码", prompt);
        Assert.Contains("不编译", prompt);
        Assert.Contains("不重启", prompt);
        // 拒绝改码时要指向真实流程，而不是含糊其辞
        Assert.Contains("发布与上线", prompt);
        Assert.Contains("PR", prompt);
        Assert.Contains("CI", prompt);
    }

    [Fact]
    public void SystemPrompt_HasNoLegacyProposalVocabulary()
    {
        var prompt = SystemAgentService.BuildSystemPrompt();
        Assert.DoesNotContain("propose_improvement", prompt);
        Assert.DoesNotContain("suggestedCode", prompt);
        Assert.DoesNotContain("analyze_code", prompt);
        Assert.DoesNotContain("read_db_schema", prompt);
    }

    // ── 设置脱敏 ────────────────────────────────────────────

    [Theory]
    [InlineData("AI:DeepSeekKey")]
    [InlineData("Baidu:AppSecret")]
    [InlineData("Smtp:Password")]
    [InlineData("Baidu:RefreshToken")]
    [InlineData("some_api_key")]
    public void RedactSettingValue_HidesSecretValues(string key)
    {
        var masked = SystemAgentService.RedactSettingValue(key, "sk-super-secret-value");
        Assert.DoesNotContain("sk-super-secret-value", masked);
        Assert.Contains("已配置", masked);
    }

    [Fact]
    public void RedactSettingValue_ReportsUnconfiguredSecretWithoutValue()
    {
        Assert.Equal("未配置", SystemAgentService.RedactSettingValue("AI:DeepSeekKey", ""));
        Assert.Equal("未配置", SystemAgentService.RedactSettingValue("AI:DeepSeekKey", null));
    }

    [Theory]
    [InlineData("AI:ModelName", "deepseek-v4-pro")]
    [InlineData("Inventory:LowStockThreshold", "5")]
    [InlineData("Auth:JwtExpireDays", "7")]
    [InlineData("AI:DeepSeekBaseUrl", "https://api.deepseek.com")]
    // 「token」既是令牌也是「数量」：计数类键名不能被误脱敏，否则助手连"输出上限是多少"都答不了
    [InlineData("AI:MaxTokens", "8192")]
    [InlineData("AI:TokenLimit", "4096")]
    public void RedactSettingValue_LeavesNonSecretValuesReadable(string key, string value)
    {
        Assert.Equal(value, SystemAgentService.RedactSettingValue(key, value));
    }

    /// <summary>计数类豁免只能放行白名单里的名字，真令牌仍然必须脱敏。</summary>
    [Theory]
    [InlineData("Baidu:AccessToken")]
    [InlineData("Baidu:RefreshToken")]
    [InlineData("Smtp:TokenSecret")]
    [InlineData("AI:MaxTokensSecret")]
    public void RedactSettingValue_StillHidesRealTokens(string key)
    {
        var masked = SystemAgentService.RedactSettingValue(key, "tok-abcdef123456");
        Assert.DoesNotContain("tok-abcdef123456", masked);
        Assert.Contains("已配置", masked);
    }

    // ── 管理员手册 ──────────────────────────────────────────

    [Fact]
    public void AdminGuide_WithoutTopic_ReturnsTopicIndex()
    {
        using var doc = JsonDocument.Parse(SystemAgentService.GetAdminGuide(null));
        var topics = doc.RootElement.GetProperty("topics").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("发布与上线", topics);
        Assert.Contains("备份与恢复", topics);
        Assert.Contains("常见故障", topics);
    }

    [Fact]
    public void AdminGuide_ExactTopic_ReturnsThatSection()
    {
        using var doc = JsonDocument.Parse(SystemAgentService.GetAdminGuide("发布与上线"));
        Assert.Equal("发布与上线", doc.RootElement.GetProperty("topic").GetString());
        var content = doc.RootElement.GetProperty("content").GetString()!;
        Assert.Contains("不能改代码", content);
        Assert.Contains("squash", content);
    }

    /// <summary>章节名记不全时，按正文关键词也能命中 —— 否则管理员问「怎么恢复」会拿到「手册没写」。</summary>
    [Fact]
    public void AdminGuide_KeywordInBody_FallsBackToBodySearch()
    {
        using var doc = JsonDocument.Parse(SystemAgentService.GetAdminGuide("邀请码"));
        Assert.True(doc.RootElement.TryGetProperty("matchedTopics", out var matched));
        Assert.Contains("用户与权限", matched.EnumerateArray().Select(t => t.GetString()));
    }

    [Fact]
    public void AdminGuide_UnknownTopic_SaysSoInsteadOfInventing()
    {
        using var doc = JsonDocument.Parse(SystemAgentService.GetAdminGuide("量子引擎调参"));
        var note = doc.RootElement.GetProperty("note").GetString()!;
        Assert.Contains("没有", note);
        Assert.True(doc.RootElement.TryGetProperty("topics", out _));
    }

    [Fact]
    public void GuideTopics_AreExposedForTheAdminUi()
    {
        var topics = SystemAgentService.GuideTopics();
        Assert.NotEmpty(topics);
        Assert.All(topics, t => Assert.False(string.IsNullOrWhiteSpace(t.Body)));
    }

    /// <summary>手册必须写明「代码改动不走本系统」，这是删掉编译重启后的对外口径。</summary>
    [Fact]
    public void AdminGuide_DocumentsTheNoSelfModificationRule()
    {
        var release = SystemAgentService.GuideTopics().Single(t => t.Topic == "发布与上线").Body;
        Assert.Contains("不能编译", release);
        Assert.Contains("不要", release);
    }
}
