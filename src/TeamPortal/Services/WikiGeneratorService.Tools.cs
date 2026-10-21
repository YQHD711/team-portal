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
        // FIX-02 纵深：二进制之外，数据库/密钥类文件同样不喂给模型（工作区里可能有仓库自带的 .env）
        if (IsBlockedReadFile(fullPath))
            return $"{{\"error\": \"Binary or sensitive file, cannot read: {path}\"}}";
        var text = File.ReadAllText(fullPath);
        if (text.Length > 15000) text = text[..15000] + $"\n\n...(truncated, total {text.Length} chars)";
        _processedFiles.Add(path);
        return text;
    }

    private string ToolSearchCode(string pattern, string path)
    {
        try
        {
            // FIX-02：空 path 也走守卫（返回工作区根的真实路径），避免绕过链接解析
            var dir = ResolvePath(path);
            if (!Directory.Exists(dir)) return $"{{\"error\": \"Directory not found\"}}";
            var results = new List<string>();
            var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
            // FIX-02：手工递归并跳过链接（SearchOption.AllDirectories 会跟目录链接进根外目录）。
            // 目录剪枝沿用 ExcludedDirs，避免把 node_modules/.git 也读一遍。
            foreach (var file in WorkspacePathGuard
                .EnumerateFilesNoLinks(dir, name => !name.StartsWith('.') && !ExcludedDirs.Contains(name))
                .Take(200))
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

    /// <summary>
    /// 禁止读给模型的扩展名（FIX-02 纵深）：二进制 + 数据库/环境变量文件。
    /// 连接符/口令即便落在工作区内（例如仓库自带 .env）也不该被当成"源码"喂给模型。
    /// </summary>
    internal static readonly HashSet<string> BlockedReadExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".dll", ".exe", ".so", ".bin", ".zip", ".png", ".jpg", ".jpeg", ".ico", ".pdf",
        ".db", ".sqlite", ".sqlite3", ".mdb", ".db-wal", ".db-shm", ".json",
    };

    /// <summary>read_file 是否应拒绝该文件（扩展名黑名单 + .env/.env.* 这类点文件）。</summary>
    internal static bool IsBlockedReadFile(string path)
    {
        var name = Path.GetFileName(path);
        if (string.IsNullOrEmpty(name)) return false;
        if (BlockedReadExtensions.Contains(Path.GetExtension(name))) return true;
        var lower = name.ToLowerInvariant();   // ".env" 这类点文件没有扩展名，GetExtension 返回空
        return lower == ".env" || lower.StartsWith(".env.", StringComparison.Ordinal);
    }

    private string ToolWriteDoc(string path, string content)
    {
        if (!IsSafeCatalogPath(path))
        {
            _logger.LogWarning("Rejected unsafe doc path from catalog: {Path}", path);
            return "{\"success\": false, \"error\": \"invalid path\"}";
        }
        var relativePath = $"{_targetFolder}/{_projectName}/{path}.md".Replace("//", "/");
        // 审计 I-04：projectName/targetFolder 来自任务行（历史任务可能含 ..），拼完必须再过一遍终态校验，
        // 否则一次 write_doc 就能把文档写到别的部门目录。IsSafeCatalogPath 会拒掉含 .. 的段。
        if (!IsSafeCatalogPath(relativePath))
        {
            _logger.LogWarning("Rejected unsafe document target (folder/project escaped): {Path}", relativePath);
            return "{\"success\": false, \"error\": \"invalid path\"}";
        }
        _knowledge.WriteFile(relativePath, content);
        _logger.LogInformation("Doc written: {Path}", relativePath);
        return $"{{\"success\": true, \"path\": \"{relativePath}\"}}";
    }

    /// <summary>
    /// FIX-02（审计 I-01/I-02/#33）：统一走 <see cref="WorkspacePathGuard"/> ——
    /// 逐段解析符号链接后按「根 + 分隔符」断言，克隆仓库里的 `leak -> /data` 不再能让模型读到库文件/令牌。
    /// 返回的是**真实路径**，调用方直接用它读文件。
    /// </summary>
    private string ResolvePath(string relativePath)
        => WorkspacePathGuard.ResolveInside(_workspacePath, relativePath);
}
