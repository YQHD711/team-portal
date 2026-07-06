namespace TeamPortal.Services;

/// <summary>
/// Configuration for Wiki AI generation.
/// Defaults optimized for DeepSeek V4 Pro (official recommendations).
/// </summary>
public class WikiGeneratorOptions
{
    /// <summary>AI model: deepseek-v4-pro (best quality) or deepseek-v4-flash (cheaper).</summary>
    public string CatalogModel { get; set; } = "deepseek-v4-pro";

    /// <summary>AI model for document content generation.</summary>
    public string ContentModel { get; set; } = "deepseek-v4-pro";

    /// <summary>Maximum AI tool-call iterations per phase (catalog + each document). Auto-adjusted by complexity detection.</summary>
    public int MaxIterations { get; set; } = 30;

    /// <summary>Maximum output tokens. DeepSeek supports up to 131,072. Cap to control cost.</summary>
    public int MaxOutputTokens { get; set; } = 32768;

    /// <summary>Number of parallel document generation tasks. 3-5 recommended.</summary>
    public int ParallelCount { get; set; } = 3;

    /// <summary>Maximum retry attempts for failed AI calls.</summary>
    public int MaxRetryAttempts { get; set; } = 2;

    /// <summary>Base retry delay in ms. Uses exponential backoff with jitter.</summary>
    public int RetryDelayMs { get; set; } = 2000;

    /// <summary>Max depth for directory tree generation.</summary>
    public int DirectoryTreeMaxDepth { get; set; } = -1; // -1 = auto (let AI decide)

    /// <summary>Max char length for README content (truncated if longer).</summary>
    public int ReadmeMaxLength { get; set; } = 10000;

    /// <summary>Timeout in minutes for single AI phase (catalog or document). 2 hours default for complex analysis.</summary>
    public int DocumentGenerationTimeoutMinutes { get; set; } = 120;

    /// <summary>Temperature. DeepSeek recommends 1.0 (do NOT use GPT defaults like 0.3-0.7).</summary>
    public double Temperature { get; set; } = 1.0;

    /// <summary>Top-P sampling. DeepSeek recommends 1.0.</summary>
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
