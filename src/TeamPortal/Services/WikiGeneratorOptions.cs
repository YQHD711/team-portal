namespace TeamPortal.Services;

/// <summary>
/// Configuration for Wiki AI generation.
/// 默认值对齐"真实在用的持久化配置"（data/wiki-settings.json），而不是模型文档里的推荐值——
/// 这样"新建/未配置"的环境行为与线上实际一致（多数情况下用户不需要改任何项）。
/// </summary>
public class WikiGeneratorOptions
{
    /// <summary>AI 模型：默认 deepseek-v4-flash（真实在用）；要质量可改 deepseek-v4-pro。</summary>
    public string CatalogModel { get; set; } = "deepseek-v4-flash";

    /// <summary>生成文档内容的 AI 模型（默认与 CatalogModel 相同：flash）。</summary>
    public string ContentModel { get; set; } = "deepseek-v4-flash";

    /// <summary>可选模型列表（Wiki 导入页下拉选择用）。</summary>
    public List<string> AvailableModels { get; set; } = new() { "deepseek-v4-pro", "deepseek-v4-flash" };   // deepseek-chat 已不在官方列表，删掉避免选到必失败的模型

    /// <summary>单次最大输出 tokens（未超 131,072 上限；注意费用）。</summary>
    public int MaxOutputTokens { get; set; } = 32768;

    /// <summary>Number of parallel document generation tasks. 3-5 recommended.</summary>
    public int ParallelCount { get; set; } = 3;

    /// <summary>Maximum retry attempts for failed AI calls.</summary>
    public int MaxRetryAttempts { get; set; } = 2;

    /// <summary>Base retry delay in ms. Uses exponential backoff with jitter.</summary>
    public int RetryDelayMs { get; set; } = 2000;

    /// <summary>目录树最大深度：-1 表示让 AI 决定。</summary>
    public int DirectoryTreeMaxDepth { get; set; } = 6; // 硬上限 6 层（-1 曾表示让 AI 决定，大仓库会生成过深目录树）

    /// <summary>Max char length for README content (truncated if longer).</summary>
    public int ReadmeMaxLength { get; set; } = 10000;

    /// <summary>Timeout in minutes for single AI phase (catalog or document). 2 hours default for complex analysis.</summary>
    public int DocumentGenerationTimeoutMinutes { get; set; } = 60;

    /// <summary>Temperature：真实在用 1.0（高随机性）；需要稳定输出可降到 0.7。</summary>
    public double Temperature { get; set; } = 1.0;

    /// <summary>Top-P：真实在用 1.0。</summary>
    public double TopP { get; set; } = 1.0;

    /// <summary>Thinking mode: non-thinking (fast/cheap), thinking (code/analysis), thinking_max (hardest problems).</summary>
    public string ThinkingMode { get; set; } = "thinking";

    /// <summary>Output document language.</summary>
    public string DocumentLanguage { get; set; } = "zh-CN";
}

public class WikiSettingsStore
{
    private static readonly string _path = Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "wiki-settings.json");

    public WikiGeneratorOptions Options { get; set; } = new();

    public static WikiSettingsStore Load()
    {
        try { if (File.Exists(_path)) return System.Text.Json.JsonSerializer.Deserialize<WikiSettingsStore>(File.ReadAllText(_path)) ?? new(); }
        catch { }
        return new();
    }

    public void Save()
    {
        var dir = Path.GetDirectoryName(_path);
        if (dir is not null) Directory.CreateDirectory(dir);
        File.WriteAllText(_path, System.Text.Json.JsonSerializer.Serialize(this, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }
}
