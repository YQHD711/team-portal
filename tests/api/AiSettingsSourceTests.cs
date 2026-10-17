using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 「不要写死 DeepSeek」的**契约测试**：模型 / 端点 / 密钥的唯一来源必须是**系统设置** `AI:*`。
///
/// 背景（本次修复的两个真实 bug）：用户可以在系统设置里填**任意 OpenAI 兼容**端点和模型，
/// 但有两处代码绕过了它：
/// - `ConversationService`（历史压缩）读的是**旧键 `AiService:ApiKey` / `AiService:BaseUrl`**，
///   并写死 `model = "deepseek-v4-flash"` → 用户改设置对压缩完全无效，换第三方端点后请求失败
///   又被 `catch {}` 静默吞掉（用户只看到"记忆不压缩"）；
/// - `SystemAgentService` 的 baseUrl 读 **`AI:DeepSeekBaseUrl`**，而设置页写的是 `AI:BaseUrl`，
///   model 兜底写死 `"deepseek-v4-pro"` → Agent 仍打 deepseek。
///
/// 两处现在都改为 `AiClient.ResolveAsync()`。这个测试钉住 `ResolveAsync` 的取值来源，
/// 防止哪天又有人"顺手"加一个服务商专属键。
/// </summary>
public class AiSettingsSourceTests
{
    private static async Task<AiOptions> ResolveWith(Dictionary<string, string> stored)
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        foreach (var (k, v) in stored)
            db.SystemSettings.Add(new SystemSetting { Key = k, Value = v, Category = "AI 服务", Description = "" });
        db.SaveChanges();

        var settings = new SettingsService(new TestScopeFactory(db));
        var ai = new AiClient(new HttpClient(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(), settings);
        return await ai.ResolveAsync();
    }

    [Fact]
    public async Task Model_ComesFromSystemSettings_NotHardcodedDeepSeek()
    {
        // 一个**非 DeepSeek** 的模型名：如果代码里还留着写死的 deepseek 字面量，这里会失败
        var opt = await ResolveWith(new() { ["AI:ModelName"] = "qwen2.5-72b-instruct" });
        Assert.Equal("qwen2.5-72b-instruct", opt.Model);
    }

    [Fact]
    public async Task BaseUrl_ComesFromSystemSettings_NotDeepSeekDefault()
    {
        // 设置页写的是 AI:BaseUrl（历史上 Agent 读的是 AI:DeepSeekBaseUrl → 用户换了端点也不生效）
        var opt = await ResolveWith(new() { ["AI:BaseUrl"] = "https://api.example-openai-compatible.com/v1" });
        Assert.Equal("https://api.example-openai-compatible.com/v1", opt.BaseUrl);
    }

    [Fact]
    public async Task ProviderOpenAiCompatible_SendsNoDeepSeekOnlyFields()
    {
        var opt = await ResolveWith(new() { ["AI:Provider"] = "openai", ["AI:EnableThinking"] = "true" });
        var ai = new AiClient(new HttpClient(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(), null!);
        var payload = ai.BuildChatPayload(opt, new object[] { new { role = "user", content = "hi" } }, stream: false);
        // thinking / reasoning_effort 是 DeepSeek 专有字段，发给通用兼容端点可能直接 400
        Assert.False(payload.ContainsKey("thinking"));
        Assert.False(payload.ContainsKey("reasoning_effort"));
    }
}
