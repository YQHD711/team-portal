using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// SystemAgentService 的代码分析部分：analyze_code 工具实现（类名→公开方法签名、方法名→实现、关键词→上下文搜索）。
/// </summary>
public partial class SystemAgentService
{
    /// <summary>
    /// Smart code analysis. For class names, returns all public methods. For method names, returns full implementation.
    /// For general keywords, returns files with 20 lines of context around each match.
    /// </summary>
    private string AnalyzeCode(string query)
    {
        try
        {
            var results = new List<object>();
            var csFiles = Directory.GetFiles(_projectRoot, "*.cs", SearchOption.AllDirectories)
                .Where(f => !f.Contains("\\bin\\") && !f.Contains("\\obj\\") && !f.Contains("\\node_modules\\"))
                .ToList();

            // Step 1: Try exact class name match
            foreach (var file in csFiles)
            {
                var content = File.ReadAllText(file);
                if (content.Contains($"class {query}") || content.Contains($"class {query} ") || content.Contains($"class {query}\r") || content.Contains($"class {query}\n"))
                {
                    // Extract all public methods from this class
                    var relativePath = Path.GetRelativePath(_projectRoot, file).Replace('\\', '/');
                    var methods = ExtractPublicMethods(content);
                    return JsonSerializer.Serialize(new
                    {
                        type = "class_analysis",
                        query,
                        file = relativePath,
                        publicMethods = methods,
                        hint = "Use these exact method signatures in your code. Parameters must match."
                    });
                }
            }

            // Step 2: Try method name match — return full method body
            foreach (var file in csFiles)
            {
                var content = File.ReadAllText(file);
                var methodPattern = @$"(public|private|protected|internal|static)\s+[\w<>\[\],\s]+\s+{query}\s*[<(]";
                var match = System.Text.RegularExpressions.Regex.Match(content, methodPattern);
                if (match.Success)
                {
                    var relativePath = Path.GetRelativePath(_projectRoot, file).Replace('\\', '/');
                    var methods = ExtractMethodsByName(content, query);
                    return JsonSerializer.Serialize(new
                    {
                        type = "method_analysis",
                        query,
                        file = relativePath,
                        methods,
                        hint = "Use these exact signatures. Don't invent method names."
                    });
                }
            }

            // Step 3: General text search with 20-line context
            foreach (var file in csFiles.Take(50))
            {
                var lines = File.ReadAllLines(file);
                for (int i = 0; i < lines.Length; i++)
                {
                    if (lines[i].Contains(query, StringComparison.OrdinalIgnoreCase))
                    {
                        var start = Math.Max(0, i - 10);
                        var end = Math.Min(lines.Length, i + 11);
                        var context = string.Join("\n", lines[start..end]);
                        var relativePath = Path.GetRelativePath(_projectRoot, file).Replace('\\', '/');
                        results.Add(new { file = relativePath, line = i + 1, context });
                        if (results.Count >= 5) break;
                    }
                }
                if (results.Count >= 5) break;
            }

            return JsonSerializer.Serialize(new { type = "search_results", query, count = results.Count, results });
        }
        catch (Exception e) { return JsonSerializer.Serialize(new { error = e.Message }); }
    }

    private static List<object> ExtractPublicMethods(string content)
    {
        var methods = new List<object>();
        var regex = new System.Text.RegularExpressions.Regex(
            @"public\s+(async\s+)?(\w+[<>\w\[\],\s]*)\s+(\w+)\s*\(([^)]*)\)",
            System.Text.RegularExpressions.RegexOptions.Multiline);
        foreach (System.Text.RegularExpressions.Match m in regex.Matches(content))
        {
            var returnType = m.Groups[2].Value.Trim();
            var name = m.Groups[3].Value;
            var parameters = m.Groups[4].Value.Trim();
            if (name != "class" && name != "void" && name.Length > 1)
                methods.Add(new { name, returnType, parameters });
        }
        return methods.Take(30).ToList();
    }

    private static List<object> ExtractMethodsByName(string content, string methodName)
    {
        var methods = new List<object>();
        var regex = new System.Text.RegularExpressions.Regex(
            $@"(public|private|protected|internal)\s+(static\s+)?(async\s+)?(\w+[<>\w\[\],\s]*)\s+{methodName}\s*\(([^)]*)\)\s*(\{{[^}}]*\}}|;)",
            System.Text.RegularExpressions.RegexOptions.Singleline);
        foreach (System.Text.RegularExpressions.Match m in regex.Matches(content))
        {
            var signature = m.Value[..Math.Min(m.Value.Length, 500)];
            methods.Add(new { signature });
            if (methods.Count >= 5) break;
        }
        return methods;
    }
}
