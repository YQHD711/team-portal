using System.Diagnostics;
using System.Text;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的工作区准备部分：克隆/解压源码、项目复杂度检测与参数自动调整、
/// 项目类型识别、目录树构建、README 与入口文件收集。
/// </summary>
public partial class WikiGeneratorService
{
    // ════════════════════════════════════════
    //  Workspace Preparation
    // ════════════════════════════════════════

    private async Task<string> PrepareWorkspace(WikiTask task)
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "teamportal-wiki", task.Id);
        Directory.CreateDirectory(baseDir);

        if (task.Type == "git")
        {
            var cloneDir = Path.Combine(baseDir, "repo");
            if (Directory.Exists(cloneDir)) Directory.Delete(cloneDir, true);

            var psi = new ProcessStartInfo("git", $"clone --depth 1 {task.SourceUrl} \"{cloneDir}\"")
            {
                RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
            };
            var proc = Process.Start(psi)!;
            var stdout = await proc.StandardOutput.ReadToEndAsync();
            var stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();

            if (proc.ExitCode != 0)
                throw new InvalidOperationException($"Git clone failed: {stderr}");

            return cloneDir;
        }
        else // zip
        {
            var zipPath = Encoding.UTF8.GetString(Convert.FromBase64String(task.SourceUrl.Replace("archive::", "")));
            if (!File.Exists(zipPath)) throw new FileNotFoundException("ZIP file not found", zipPath);

            var extractDir = Path.Combine(baseDir, "repo");
            System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, extractDir, true);
            return extractDir;
        }
    }

    // ════════════════════════════════════════
    //  Project Context — 项目上下文收集
    // ════════════════════════════════════════

    private string DetectProjectType()
    {
        var root = _workspacePath;
        var types = new List<string>();
        if (Directory.GetFiles(root, "*.csproj", SearchOption.AllDirectories).Any() || Directory.GetFiles(root, "*.sln").Any()) types.Add("dotnet");
        if (File.Exists(Path.Combine(root, "package.json")))
        {
            var pkg = File.ReadAllText(Path.Combine(root, "package.json"));
            types.Add(pkg.Contains("\"next\"") || pkg.Contains("\"react\"") || pkg.Contains("\"vue\"") ? "frontend" : "nodejs");
        }
        if (Directory.GetFiles(root, "pom.xml").Any() || Directory.GetFiles(root, "build.gradle*").Any()) types.Add("java");
        if (File.Exists(Path.Combine(root, "go.mod"))) types.Add("go");
        if (File.Exists(Path.Combine(root, "requirements.txt")) || File.Exists(Path.Combine(root, "pyproject.toml")) || File.Exists(Path.Combine(root, "setup.py"))) types.Add("python");
        if (File.Exists(Path.Combine(root, "Cargo.toml"))) types.Add("rust");
        if (types.Count == 0) return "unknown";
        if (types.Count > 1) return "fullstack:" + string.Join("+", types);
        return types[0];
    }

    private string BuildDirectoryTree()
    {
        var sb = new StringBuilder();
        BuildTreeRecursive(_workspacePath, "", sb, 0, 3);
        return sb.ToString();
    }

    private void BuildTreeRecursive(string dir, string prefix, StringBuilder sb, int depth, int maxDepth)
    {
        if (maxDepth >= 0 && depth > maxDepth) return; // -1 = unlimited
        try
        {
            foreach (var subDir in Directory.GetDirectories(dir).OrderBy(Path.GetFileName))
            {
                var name = Path.GetFileName(subDir);
                if (name.StartsWith('.') || ExcludedDirs.Contains(name)) continue;
                sb.AppendLine($"{prefix}├── 📁 {name}");
                BuildTreeRecursive(subDir, prefix + "│   ", sb, depth + 1, maxDepth);
            }
            if (depth <= 1)
                foreach (var file in Directory.GetFiles(dir, "*.*").OrderBy(Path.GetFileName).Take(30))
                    if (!Path.GetFileName(file).StartsWith('.'))
                        sb.AppendLine($"{prefix}├── 📄 {Path.GetFileName(file)}");
        }
        catch { /* skip inaccessible */ }
    }

    private string ReadReadme()
    {
        foreach (var name in new[] { "README.md", "README.MD", "readme.md", "README" })
        {
            var path = Path.Combine(_workspacePath, name);
            if (File.Exists(path))
            {
                var text = File.ReadAllText(path);
                return text.Length > 10000 ? text[..10000] + "\n...(truncated)" : text;
            }
        }
        return "(No README found)";
    }

    private string IdentifyEntryPoints()
    {
        var entries = new List<string>();
        foreach (var pattern in new[] { "Program.cs", "Startup.cs", "main.py", "app.py", "main.go", "index.tsx", "index.ts", "App.tsx", "main.ts", "main.tsx" })
        {
            foreach (var f in Directory.GetFiles(_workspacePath, pattern, SearchOption.AllDirectories).Take(2))
            {
                var rel = Path.GetRelativePath(_workspacePath, f).Replace('\\', '/');
                if (!rel.Contains("node_modules") && !rel.Contains("bin/") && !rel.Contains("obj/"))
                    entries.Add(rel);
            }
        }
        return string.Join("\n", entries.Distinct().Take(10).Select(e => $"- {e}"));
    }

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
