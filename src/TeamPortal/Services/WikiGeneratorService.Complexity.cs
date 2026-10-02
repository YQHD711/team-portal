namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的复杂度检测部分：扫描工作区估算项目规模，并按规模自动调整生成参数
/// （模型、目录深度、并发数、超时、思考模式）。仅克隆路径不会用到这里——不花 AI 成本。
/// </summary>
public partial class WikiGeneratorService
{
    // ════════════════════════════════════════
    //  Complexity Detection — 复杂度检测与参数调整
    // ════════════════════════════════════════

    /// <summary>Project complexity score used to auto-tune generation parameters.</summary>
    private record ComplexityInfo(int Score, int FileCount, int DirCount, int LinesOfCode);

    /// <summary>
    /// Analyze workspace to determine project complexity (1-5 scale).
    /// Simple: <30 files, <5 dirs, <2000 LOC → score 1-2
    /// Moderate: 30-100 files, 5-15 dirs, 2000-10000 LOC → score 3
    /// Complex: >100 files, >15 dirs, >10000 LOC → score 4-5
    /// </summary>
    private static ComplexityInfo DetectProjectComplexity(string workspacePath)
    {
        var srcDir = Path.Combine(workspacePath, "repo");
        if (!Directory.Exists(srcDir)) return new ComplexityInfo(1, 0, 0, 0);

        var codeExts = new HashSet<string> { ".cs", ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".vue", ".svelte", ".swift", ".kt", ".rb", ".php", ".css", ".scss", ".json", ".yaml", ".yml", ".xml", ".csproj", ".sln", ".toml" };
        var files = Directory.GetFiles(srcDir, "*.*", SearchOption.AllDirectories);
        var codeFiles = files.Where(f => codeExts.Contains(Path.GetExtension(f).ToLowerInvariant())).ToArray();
        var dirs = Directory.GetDirectories(srcDir, "*", SearchOption.AllDirectories).Length;

        int totalLines = 0;
        foreach (var f in codeFiles.Take(200)) // Sample first 200 files for speed
        {
            try { totalLines += File.ReadLines(f).Take(500).Count(); } catch { }
        }

        // Compute score
        int score;
        if (codeFiles.Length < 20 && dirs < 5 && totalLines < 1500) score = 1;
        else if (codeFiles.Length < 50 && dirs < 10 && totalLines < 5000) score = 2;
        else if (codeFiles.Length < 120 && dirs < 20 && totalLines < 15000) score = 3;
        else if (codeFiles.Length < 250 && totalLines < 50000) score = 4;
        else score = 5;

        return new ComplexityInfo(score, codeFiles.Length, dirs, totalLines);
    }

    /// <summary>
    /// Auto-adjust generation parameters based on project complexity score.
    /// Simple projects get fewer iterations, smaller tokens, Flash model to avoid over-documentation.
    /// Complex projects get Pro model and more iterations for thorough coverage.
    /// </summary>
    private void AutoAdjustParameters(ComplexityInfo c)
    {
        // Model selection based on complexity — simple projects use flash (cheaper/faster)
        var model = c.Score <= 2 ? "deepseek-v4-flash" : "deepseek-v4-pro";
        _options.ContentModel = model;
        _options.CatalogModel = model;

        // Directory depth: shallow for simple projects, unlimited for complex
        _options.DirectoryTreeMaxDepth = c.Score switch
        {
            1 => 2,
            2 => 3,
            _ => -1,
        };

        // Parallelism: fewer concurrent docs for simple, more for complex
        _options.ParallelCount = c.Score <= 2 ? 2 : c.Score >= 4 ? 5 : 3;

        // Timeout scales with complexity
        _options.DocumentGenerationTimeoutMinutes = c.Score switch
        {
            1 => 30,
            2 => 60,
            3 => 90,
            4 => 120,
            _ => 180,
        };

        // Thinking mode only for complex projects
        _options.ThinkingMode = c.Score >= 4 ? "thinking" : "non-thinking";
    }
}
