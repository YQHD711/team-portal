using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// SystemAgentService 的工具执行部分：工具分发与只读工具实现（系统统计/日志/读文件/数据库模式/列目录）。
/// </summary>
public partial class SystemAgentService
{
    private async Task<string> ExecuteTool(string name, string args, string userName)
    {
        try
        {
            using var a = JsonDocument.Parse(args);
            var r = a.RootElement;

            string result = name switch
            {
                "get_system_stats" => await GetSystemStats(),
                "read_logs" => await ReadLogs(r.TryGetProperty("hours", out var h) ? h.GetInt32() : 24),
                "read_file" => ReadCodeFile(r.GetProperty("path").GetString()!),
                "analyze_code" => AnalyzeCode(r.GetProperty("query").GetString()!),
                "read_db_schema" => await ReadDbSchema(r.TryGetProperty("entityName", out var en) ? en.GetString()! : "all"),
                "list_files" => ListProjectFiles(r.TryGetProperty("subdir", out var sd) ? sd.GetString()! : ""),
                "propose_improvement" => CreateProposal(r, userName),
                "list_proposals" => await ListProposals(),
                _ => "unknown"
            };

            if (result == "unknown")
            {
                _log.Warn("agent", $"Unknown tool: {name}", args[..Math.Min(100, args.Length)], userName);
                return $"{{\"error\": \"Unknown tool: {name}\"}}";
            }
            return result;
        }
        catch (Exception e)
        {
            _log.Error("agent", $"Tool error: {name}", e.Message, userName);
            return $"{{\"error\": \"{e.Message}\"}}";
        }
    }

    private async Task<string> GetSystemStats()
    {
        var users = await _db.Users.CountAsync();
        var parts = await _db.InventoryItems.CountAsync();
        var totalQty = await _db.InventoryItems.SumAsync(i => i.Quantity);
        var depts = await _db.Departments.CountAsync();
        var logs = await _db.SystemLogs.CountAsync();
        var errors = await _db.SystemLogs.CountAsync(l => l.Level == "error");
        var wiki = await _db.WikiTasks.CountAsync(t => t.Status == "completed");
        var dbPath = Path.Combine(Directory.GetCurrentDirectory(), "data", "teamportal.db");
        var dbSize = File.Exists(dbPath) ? new FileInfo(dbPath).Length : 0;

        return JsonSerializer.Serialize(new { users, parts, totalQty, depts, totalLogs = logs, errors24h = errors, completedWikiProjects = wiki, dbSizeKB = dbSize / 1024 });
    }

    private async Task<string> ReadLogs(int hours)
    {
        var since = DateTime.UtcNow.AddHours(-hours);
        var logs = await _db.SystemLogs.Where(l => l.CreatedAt >= since).OrderByDescending(l => l.Id).Take(100).ToListAsync();
        return JsonSerializer.Serialize(logs.Select(l => new { l.Level, l.Category, l.Message, l.UserName, l.CreatedAt }));
    }

    private static string? ResolveInside(string root, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath)) return null;
        var full = Path.GetFullPath(Path.Combine(root, relativePath));
        var normRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normFull = full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return normFull.StartsWith(normRoot, StringComparison.OrdinalIgnoreCase) ? full : null;
    }

    private string ReadCodeFile(string path)
    {
        var full = ResolveInside(_projectRoot, path);
        if (full is null) return $"{{\"error\": \"Access denied: {path}\"}}";
        if (!File.Exists(full)) return $"{{\"error\": \"File not found: {path}\"}}";
        var content = File.ReadAllText(full);
        _readFiles.Add(path);
        return content.Length > 20000 ? content[..20000] + "\n...(truncated)" : content;
    }

    private async Task<string> ReadDbSchema(string entityName)
    {
        try
        {
            var entityTypes = _db.Model.GetEntityTypes()
                .Where(e => entityName == "all" || e.Name.Contains(entityName, StringComparison.OrdinalIgnoreCase))
                .ToList();

            var result = entityTypes.Select(et => new
            {
                table = et.Name,
                properties = et.GetProperties().Select(p => new
                {
                    name = p.Name,
                    type = p.ClrType.Name,
                    nullable = p.IsNullable,
                    maxLength = p.GetMaxLength(),
                    isKey = p.IsPrimaryKey(),
                }).ToList(),
                foreignKeys = et.GetForeignKeys().Select(fk => new
                {
                    from = string.Join(",", fk.Properties.Select(p => p.Name)),
                    to = fk.PrincipalEntityType.Name
                }).ToList()
            }).ToList();

            if (result.Count == 0)
                return JsonSerializer.Serialize(new { error = $"No model '{entityName}'. Try: User, InventoryItem, Department, WikiTask, CodeProposal, Notification, SystemLog, ChatMessage, SystemSetting" });
            return JsonSerializer.Serialize(result);
        }
        catch (Exception ex) { return JsonSerializer.Serialize(new { error = ex.Message }); }
    }

    private string ListProjectFiles(string subdir)
    {
        try
        {
            var searchDir = string.IsNullOrEmpty(subdir) ? _projectRoot : ResolveInside(_projectRoot, subdir);
            if (searchDir is null)
                return JsonSerializer.Serialize(new { error = $"Access denied: {subdir}" });
            if (!Directory.Exists(searchDir))
                return JsonSerializer.Serialize(new { error = $"Directory not found: {subdir}" });

            var files = Directory.GetFileSystemEntries(searchDir, "*", SearchOption.TopDirectoryOnly)
                .Select(p => new
                {
                    name = Path.GetFileName(p),
                    type = Directory.Exists(p) ? "dir" : "file",
                    path = Path.GetRelativePath(_projectRoot, p).Replace('\\', '/')
                })
                .OrderBy(f => f.type).ThenBy(f => f.name)
                .Take(100)
                .ToList();

            return JsonSerializer.Serialize(new { directory = subdir, count = files.Count, entries = files });
        }
        catch (Exception ex) { return JsonSerializer.Serialize(new { error = ex.Message }); }
    }
}
