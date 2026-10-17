using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的**工具执行**部分：AI 可调用的文件系统工具（列目录/读文件/搜代码/写文档/写目录）。
///
/// 本文件是从原 <c>WikiGeneratorService.DeepSeek.cs</c> **原样搬迁**（工具名、参数、返回 JSON 形状、
/// 未知工具与异常的 error 形状都不变），只是拆出来让单文件 ≤200 行。
/// </summary>
public partial class WikiGeneratorService
{
    private async Task<string> ExecuteTool(string name, string argsJson)
    {
        try
        {
            using var args = JsonDocument.Parse(argsJson);
            var root = args.RootElement;

            return name switch
            {
                "list_files" => ToolListFiles(GetArg(root, "path")),
                "read_file" => ToolReadFile(GetArg(root, "path")),
                "search_code" => ToolSearchCode(GetArg(root, "pattern"), GetArg(root, "path") ?? ""),
                "write_catalog" => ToolWriteCatalog(GetArg(root, "json")),
                "write_doc" => ToolWriteDoc(GetArg(root, "path"), GetArg(root, "content")),
                _ => $"{{\"error\": \"Unknown tool: {name}\"}}"
            };
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private static string GetArg(JsonElement root, string key) => root.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";

    private string ToolListFiles(string path)
    {
        var dir = ResolvePath(path);
        if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found: {path}\"}}";
        var items = new List<string>();
        foreach (var d in Directory.GetDirectories(dir).Select(Path.GetFileName).Where(n => !n.StartsWith('.') && !ExcludedDirs.Contains(n!)).OrderBy(n => n))
            items.Add($"📁 {d}/");
        foreach (var f in Directory.GetFiles(dir).Select(Path.GetFileName).Where(n => !n!.StartsWith('.')).OrderBy(n => n).Take(50))
            items.Add($"📄 {f}");
        return JsonSerializer.Serialize(new { path, items });
    }

    private string ToolReadFile(string path)
    {
        var fullPath = ResolvePath(path);
        if (!File.Exists(fullPath)) return $"{{\"error\": \"File not found: {path}\"}}";
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();
        if (ext is ".dll" or ".exe" or ".so" or ".bin" or ".zip" or ".png" or ".jpg" or ".ico" or ".pdf")
            return $"{{\"error\": \"Binary file, cannot read: {path}\"}}";
        var text = File.ReadAllText(fullPath);
        if (text.Length > 15000) text = text[..15000] + $"\n\n...(truncated, total {text.Length} chars)";
        _processedFiles.Add(path);
        return text;
    }

    private string ToolSearchCode(string pattern, string path)
    {
        try
        {
            var dir = string.IsNullOrEmpty(path) ? _workspacePath : ResolvePath(path);
            if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found\"}}";
            var results = new List<string>();
            var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
            foreach (var file in Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories).Take(200))
            {
                var name = Path.GetFileName(file);
                if (name.StartsWith('.') || file.Contains("node_modules") || file.Contains(".git")) continue;
                try
                {
                    var lines = File.ReadAllLines(file);
                    for (int i = 0; i < lines.Length; i++)
                        if (regex.IsMatch(lines[i]))
                            results.Add($"{Path.GetRelativePath(_workspacePath, file).Replace('\\', '/')}:{i + 1}: {lines[i].Trim()[..Math.Min(lines[i].Trim().Length, 120)]}");
                    if (results.Count > 50) break;
                }
                catch { /* skip binary */ }
            }
            return JsonSerializer.Serialize(new { pattern, matches = results.Take(50).ToList(), total = results.Count });
        }
        catch (Exception e) { return $"{{\"error\": \"{e.Message}\"}}"; }
    }

    private string ToolWriteCatalog(string json) { _catalogJson = json; return "{\"success\": true, \"message\": \"Catalog saved\"}"; }

    /// <summary>
    /// 目录清单里的 path 来自模型输出或请求方提供的 customCatalogJson。
    /// 直接拼进知识库路径会被 "../../他部门/x" 穿越(KnowledgeService 只保证不越出知识库根,
    /// 挡不住跨部门覆盖),因此这里只接受安全的相对片段。
    /// </summary>
    internal static bool IsSafeCatalogPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var normalized = path.Replace('\\', '/');
        if (normalized.StartsWith('/') || normalized.Contains(':')) return false; // 绝对路径 / 盘符 / ADS
        var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length > 0 && segments.All(s => s is not ("." or ".."));
    }

    private string ToolWriteDoc(string path, string content)
    {
        if (!IsSafeCatalogPath(path))
        {
            _logger.LogWarning("Rejected unsafe doc path from catalog: {Path}", path);
            return "{\"success\": false, \"error\": \"invalid path\"}";
        }
        var relativePath = $"{_targetFolder}/{_projectName}/{path}.md".Replace("//", "/");
        _knowledge.WriteFile(relativePath, content);
        _logger.LogInformation("Doc written: {Path}", relativePath);
        return $"{{\"success\": true, \"path\": \"{relativePath}\"}}";
    }

    private string ResolvePath(string relativePath)
    {
        var full = Path.GetFullPath(Path.Combine(_workspacePath, relativePath));
        var norm = Path.GetFullPath(_workspacePath);
        return full.StartsWith(norm) ? full : throw new InvalidOperationException("Path traversal denied");
    }
}
