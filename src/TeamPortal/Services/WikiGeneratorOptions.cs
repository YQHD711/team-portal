namespace TeamPortal.Services;

/// <summary>
/// Configuration options for Wiki generation.
/// Inspired by OpenDeepWiki WikiGeneratorOptions.
/// </summary>
public class WikiGeneratorOptions
{
    /// <summary>AI model for catalog generation.</summary>
    public string CatalogModel { get; set; } = "deepseek-chat";

    /// <summary>AI model for document content generation.</summary>
    public string ContentModel { get; set; } = "deepseek-chat";

    /// <summary>Maximum tokens for AI output.</summary>
    public int MaxOutputTokens { get; set; } = 4096;

    /// <summary>Number of parallel document generation tasks.</summary>
    public int ParallelCount { get; set; } = 3;

    /// <summary>Maximum retry attempts for failed AI calls.</summary>
    public int MaxRetryAttempts { get; set; } = 2;

    /// <summary>Base retry delay in milliseconds (exponential backoff).</summary>
    public int RetryDelayMs { get; set; } = 2000;

    /// <summary>Maximum depth for directory tree generation.</summary>
    public int DirectoryTreeMaxDepth { get; set; } = 3;

    /// <summary>Maximum character length for README content.</summary>
    public int ReadmeMaxLength { get; set; } = 10000;

    /// <summary>Timeout in minutes for single document generation.</summary>
    public int DocumentGenerationTimeoutMinutes { get; set; } = 5;

    /// <summary>Temperature for AI generation (0.0-2.0). Lower = more deterministic.</summary>
    public double Temperature { get; set; } = 0.3;

    /// <summary>System prompt language for generated documents.</summary>
    public string DocumentLanguage { get; set; } = "zh-CN";
}

/// <summary>
/// Persisted wiki settings stored in a JSON file.
/// </summary>
public class WikiSettingsStore
{
    private static readonly string _path = Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "wiki-settings.json");

    public WikiGeneratorOptions Options { get; set; } = new();

    public static WikiSettingsStore Load()
    {
        try
        {
            if (File.Exists(_path))
                return System.Text.Json.JsonSerializer.Deserialize<WikiSettingsStore>(File.ReadAllText(_path)) ?? new();
        }
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
