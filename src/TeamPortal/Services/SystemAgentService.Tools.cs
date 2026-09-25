using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// AI 运维助手的工具分发与「系统层」只读工具（健康、统计、日志）。
/// 全部工具只读：没有写文件、改设置、建提案、编译重启的入口。
/// </summary>
public partial class SystemAgentService
{
    /// <summary>工具分发。参数解析失败/工具名未知都返回 JSON 错误串，绝不抛给上层循环。</summary>
    internal async Task<string> ExecuteTool(string name, string args, string userName)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(args) ? "{}" : args);
            var r = doc.RootElement;

            var result = name switch
            {
                "get_system_health" => await GetSystemHealth(),
                "get_system_stats" => await GetSystemStats(),
                "read_logs" => await ReadLogs(r),
                "list_backups" => ListBackups(),
                "get_settings" => await GetSettings(OptStr(r, "category")),
                "knowledge_overview" => KnowledgeOverview(),
                "search_knowledge" => SearchKnowledge(OptStr(r, "query") ?? "", OptInt(r, "topK") ?? 5),
                "team_overview" => await TeamOverview(),
                "get_admin_guide" => GetAdminGuide(OptStr(r, "topic")),
                _ => null
            };

            if (result is null)
            {
                _log.Warn("agent", $"Unknown tool: {name}", args[..Math.Min(100, args.Length)], userName);
                return JsonSerializer.Serialize(new { error = $"未知工具 {name}。可用工具：{string.Join("、", BuildTools().Select(t => t.Name))}" });
            }
            return result;
        }
        catch (Exception e)
        {
            _log.Error("agent", $"Tool error: {name}", e.Message, userName);
            return JsonSerializer.Serialize(new { error = e.Message });
        }
    }

    // ── 参数读取：可选参数缺失、类型不对、空串一律当「没传」，不抛异常 ──

    private static string? OptStr(JsonElement r, string name)
    {
        if (r.ValueKind != JsonValueKind.Object || !r.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
            return null;
        var s = v.GetString();
        return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }

    private static int? OptInt(JsonElement r, string name)
        => r.ValueKind == JsonValueKind.Object && r.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : null;

    private static string? Cap(string? s, int max)
        => string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s[..max] + "…");

    // ── 工具实现 ──

    /// <summary>健康总览。db / logChannel 直接复用 LogService，避免两处判据漂移（status 见 db.status）。</summary>
    private async Task<string> GetSystemHealth()
    {
        var db = await _log.GetHealth();
        var logChannel = await _log.GetStats();

        var proc = System.Diagnostics.Process.GetCurrentProcess();
        proc.Refresh();
        var uptime = DateTime.UtcNow - proc.StartTime.ToUniversalTime();

        object? disk = null;
        try
        {
            var d = DriveInfo.GetDrives().FirstOrDefault(x => x.IsReady);
            if (d is not null)
                disk = new
                {
                    totalGB = Math.Round(d.TotalSize / 1e9, 2),
                    freeGB = Math.Round(d.AvailableFreeSpace / 1e9, 2),
                    usedPct = Math.Round((double)(d.TotalSize - d.AvailableFreeSpace) / d.TotalSize * 100, 1)
                };
        }
        catch { /* 沙箱/无驱动器时取不到，不是错误 */ }

        return JsonSerializer.Serialize(new
        {
            db,
            logChannel,
            process = new
            {
                uptimeHours = Math.Round(uptime.TotalHours, 1),
                workingSetMB = Math.Round(proc.WorkingSet64 / 1048576.0, 1),
                threads = proc.Threads.Count,
                gcHeapMB = Math.Round(GC.GetTotalMemory(false) / 1048576.0, 1)
            },
            disk,
            note = "结论看 db.status（healthy/degraded/unhealthy）；日志通道积压看 logChannel.pendingWrites，持续偏大说明落库跟不上。"
        });
    }

    private async Task<string> GetSystemStats()
    {
        var users = await _db.Users.CountAsync();
        var parts = await _db.InventoryItems.CountAsync();
        var totalQty = await _db.InventoryItems.SumAsync(i => (int?)i.Quantity) ?? 0;
        var depts = await _db.Departments.CountAsync();
        var logs = await _db.SystemLogs.CountAsync();
        var errors = await _db.SystemLogs.CountAsync(l => l.Level == "error");
        var wiki = await _db.WikiTasks.CountAsync(t => t.Status == "completed");
        var wikiRunning = await _db.WikiTasks.CountAsync(t => t.Status != "completed" && t.Status != "failed");
        var dbPath = Path.Combine(Directory.GetCurrentDirectory(), "data", "teamportal.db");
        var dbSize = File.Exists(dbPath) ? new FileInfo(dbPath).Length : 0;

        return JsonSerializer.Serialize(new
        {
            users, depts, parts, totalQty,
            totalLogs = logs, errorLogs = errors,
            completedWikiProjects = wiki, runningWikiTasks = wikiRunning,
            dbSizeKB = dbSize / 1024
        });
    }

    private async Task<string> ReadLogs(JsonElement r)
    {
        var hours = Math.Clamp(OptInt(r, "hours") ?? 24, 1, 720);
        var limit = Math.Clamp(OptInt(r, "limit") ?? 100, 1, 200);
        var level = OptStr(r, "level");
        var category = OptStr(r, "category");
        var keyword = OptStr(r, "keyword");

        var since = DateTime.UtcNow.AddHours(-hours);
        var q = _db.SystemLogs.Where(l => l.CreatedAt >= since);
        if (level is not null) q = q.Where(l => l.Level == level);
        if (category is not null) q = q.Where(l => l.Category == category);
        if (keyword is not null)
            q = q.Where(l => l.Message.Contains(keyword) || (l.Detail != null && l.Detail.Contains(keyword)));

        var items = await q.OrderByDescending(l => l.Id).Take(limit).ToListAsync();
        return JsonSerializer.Serialize(new
        {
            hours,
            filters = new { level, category, keyword },
            count = items.Count,
            logs = items.Select(l => new { l.Level, l.Category, l.Message, detail = Cap(l.Detail, 300), l.UserName, l.CreatedAt }),
            note = items.Count == 0 ? "该条件下没有日志：可能是时间范围太窄或过滤条件过严，可用更大的 hours 或去掉 level/category/keyword 重试（日志异步落库，最近几秒的可能还在缓冲）。" : null
        });
    }
}
