using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// AI 运维助手的「数据层」只读工具：备份、设置、知识库、团队业务、管理员手册。
/// </summary>
public partial class SystemAgentService
{
    private string ListBackups()
    {
        var list = _backup.ListBackups(); // 已按创建时间倒序
        return JsonSerializer.Serialize(new
        {
            count = list.Count,
            latest = list.FirstOrDefault()?.FileName,
            latestAt = list.FirstOrDefault()?.CreatedAt,
            backups = list.Take(10).Select(b => new
            {
                b.FileName,
                b.Tag,
                sizeMB = Math.Round(b.SizeBytes / 1048576.0, 2),
                b.CreatedAt
            }),
            stats = _backup.GetStats(),
            note = "本地库每 6 小时备份一次、每天一次日备份；最新一份不允许删除。恢复入口在 /admin/backup。"
        });
    }

    private async Task<string> GetSettings(string? category)
    {
        var grouped = await _settings.GetAllGrouped();
        var matched = grouped
            .Where(g => category is null || g.Key.Contains(category, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (matched.Count == 0)
            return JsonSerializer.Serialize(new
            {
                categories = grouped.Keys,
                note = $"没有匹配「{category}」的分类，可用分类见 categories。"
            });

        var data = matched.ToDictionary(
            g => g.Key,
            g => g.Value.Select(s => new
            {
                s.Key,
                value = RedactSettingValue(s.Key, s.Value),
                s.Description
            }).ToList());

        return JsonSerializer.Serialize(new { count = data.Sum(d => d.Value.Count), settings = data });
    }

    /// <summary>
    /// 设置值脱敏（纯函数，便于单测）：密钥/密码/令牌一类只回答「是否已配置」，
    /// 否则本助手会把 AI:DeepSeekKey 之类的明文念出来（对话还会落库到会话记忆里）。
    /// </summary>
    internal static string RedactSettingValue(string key, string? value)
    {
        if (!IsSecretKey(key)) return value ?? "";
        return string.IsNullOrWhiteSpace(value) ? "未配置" : $"已配置（{value.Length} 字符，内容已隐藏）";
    }

    private static bool IsSecretKey(string key)
    {
        var normalized = new string(key.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        // 「token」既是令牌也是「数量」的同义词：AI:MaxTokens 是数字上限，不是密钥。
        // 只对这些明确的计数类键名放行，宁可漏脱敏一个计数项，也不能把真令牌念出来。
        if (NotSecretKeys.Any(normalized.EndsWith)) return false;
        return SecretHints.Any(normalized.Contains);
    }

    private static readonly string[] SecretHints = ["key", "secret", "password", "pwd", "token", "credential", "apikey"];
    private static readonly string[] NotSecretKeys = ["maxtokens", "tokenlimit", "tokencount", "maxcontexttokens"];

    /// <summary>知识库概览。直接扫目录而不用 KnowledgeService.GetTree：后者会 EnsureDirectories（建目录），本助手保持纯只读。</summary>
    private string KnowledgeOverview()
    {
        var root = _knowledge.BasePath;
        if (!Directory.Exists(root))
            return JsonSerializer.Serialize(new { error = $"知识库目录不存在：{root}" });

        var scopes = new List<object>();
        var totalDocs = 0;
        var emptyScopes = new List<string>();

        foreach (var dir in Directory.GetDirectories(root)
                     .Where(d => !Path.GetFileName(d).StartsWith('.'))
                     .OrderBy(d => Path.GetFileName(d), StringComparer.Ordinal))
        {
            var (count, updated) = ScanDocs(dir);
            totalDocs += count;
            if (count == 0) emptyScopes.Add(Path.GetFileName(dir));
            scopes.Add(new { name = Path.GetFileName(dir), docCount = count, lastUpdatedAt = updated });
        }

        var rootDocs = Directory.GetFiles(root, "*.md")
            .Count(f => !Path.GetFileName(f).StartsWith('.'));
        totalDocs += rootDocs;

        return JsonSerializer.Serialize(new
        {
            root,
            totalMarkdownFiles = totalDocs,
            rootLevelDocs = rootDocs,
            scopes,
            note = emptyScopes.Count > 0
                ? $"以下顶层目录一篇文档都没有：{string.Join("、", emptyScopes)}——可能是建了部门但还没人写，或写到了别处。"
                : "各顶层目录都有文档。目录名即权限：公共知识库全员可见，部门目录仅本部门可见。"
        });
    }

    /// <summary>统计目录下 .md 数量与最近修改时间；.history 等点目录视为基础设施，跳过。</summary>
    private static (int Count, DateTime? Updated) ScanDocs(string dir)
    {
        try
        {
            var files = Directory.GetFiles(dir, "*.md", SearchOption.AllDirectories)
                .Where(f => !f.Replace('\\', '/').Split('/').Any(seg => seg.StartsWith('.')))
                .ToArray();
            if (files.Length == 0) return (0, null);
            return (files.Length, files.Max(File.GetLastWriteTimeUtc));
        }
        catch
        {
            return (0, null);
        }
    }

    private string SearchKnowledge(string query, int topK)
    {
        if (string.IsNullOrWhiteSpace(query))
            return JsonSerializer.Serialize(new { error = "query 不能为空" });

        var hits = _search.Search(query, Math.Clamp(topK, 1, 10), "admin", null, 0);
        return JsonSerializer.Serialize(new
        {
            query,
            count = hits.Count,
            results = hits.Select(h => new { h.Path, snippet = Cap(h.Snippet, 300), score = Math.Round(h.Score, 3) }),
            note = hits.Count == 0 ? "知识库里没有匹配内容（检索是关键词匹配，换更短的词试试）。" : null
        });
    }

    private async Task<string> TeamOverview()
    {
        var threshold = await _settings.GetInt("Inventory:LowStockThreshold", InventoryService.DefaultLowStockThreshold);

        var users = await _db.Users
            .Select(u => new { u.Role, dept = u.Department != null ? u.Department.Name : "未分配" })
            .ToListAsync();
        var byDept = users
            .GroupBy(u => u.dept)
            .Select(g => new
            {
                dept = g.Key,
                total = g.Count(),
                byRole = g.GroupBy(x => x.Role).ToDictionary(r => r.Key, r => r.Count())
            })
            .OrderByDescending(g => g.total)
            .ToList();

        var lowStockTotal = await _db.InventoryItems.CountAsync(i => i.Quantity < threshold);
        var lowStock = await _db.InventoryItems
            .Where(i => i.Quantity < threshold)
            .OrderBy(i => i.Quantity).Take(20)
            .Select(i => new { i.Name, i.Quantity, i.LocationCode })
            .ToListAsync();

        var wikiByStatus = await _db.WikiTasks
            .GroupBy(t => t.Status)
            .Select(g => new { status = g.Key, count = g.Count() })
            .ToListAsync();
        var wikiFailures = await _db.WikiTasks
            .Where(t => t.Status == "failed")
            .OrderByDescending(t => t.CreatedAt).Take(5)
            .Select(t => new { t.ProjectName, error = t.ErrorMessage, t.CreatedAt })
            .ToListAsync();

        return JsonSerializer.Serialize(new
        {
            departments = byDept,
            inventory = new { lowStockThreshold = threshold, lowStockKinds = lowStockTotal, items = lowStock },
            wiki = new { byStatus = wikiByStatus, recentFailures = wikiFailures }
        });
    }
}
