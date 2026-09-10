using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>LogService — CSV 导出。</summary>
public partial class LogService
{
    /// <summary>操作日志 CSV 导出(时间,操作人,操作类型,目标类型,目标,数据,IP)</summary>
    public async Task<string> ExportOperationsCsv(string? user = null, string? action = null,
        DateTime? from = null, DateTime? to = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.OperationLogs.AsQueryable();
        if (!string.IsNullOrEmpty(user)) query = query.Where(o => o.UserName == user);
        if (!string.IsNullOrEmpty(action)) query = query.Where(o => o.Action == action);
        if (from.HasValue) query = query.Where(o => o.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(o => o.CreatedAt <= to.Value);
        var logs = await query.OrderByDescending(o => o.Id).Take(10000).ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("时间,操作人,操作类型,目标类型,目标,数据,IP");
        foreach (var o in logs)
            sb.AppendLine($"{o.CreatedAt:yyyy-MM-dd HH:mm:ss},{o.UserName},{o.Action},{o.TargetType ?? ""},{o.TargetId ?? ""},\"{o.Data?.Replace("\"", "\"\"") ?? ""}\",{o.IpAddress ?? ""}");
        return sb.ToString();
    }

    public async Task<string> ExportCsv(string? level = null, DateTime? from = null, DateTime? to = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.SystemLogs.AsQueryable();
        if (!string.IsNullOrEmpty(level)) query = query.Where(l => l.Level == level);
        if (from.HasValue) query = query.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(l => l.CreatedAt <= to.Value);
        var logs = await query.OrderByDescending(l => l.Id).Take(10000).ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("时间,级别,分类,消息,用户");
        foreach (var l in logs)
            sb.AppendLine($"{l.CreatedAt:yyyy-MM-dd HH:mm:ss},{l.Level},{l.Category},\"{l.Message?.Replace("\"", "\"\"")}\",{l.UserName ?? ""}");
        return sb.ToString();
    }
}
