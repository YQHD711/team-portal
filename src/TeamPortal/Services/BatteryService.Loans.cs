using Microsoft.EntityFrameworkCore;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>BatteryService 的查询部分（流水/我的在借/超时），拆文件控制单文件行数。</summary>
public partial class BatteryService
{
    public async Task<List<BatteryLoan>> GetLoansAsync(int? batteryId, int? userId, bool activeOnly, int take)
    {
        var query = _db.BatteryLoans
            .Include(l => l.Battery)
            .Include(l => l.User)
            .Include(l => l.ReturnedBy)
            .AsQueryable();
        if (batteryId.HasValue) query = query.Where(l => l.BatteryId == batteryId.Value);
        if (userId.HasValue) query = query.Where(l => l.UserId == userId.Value);
        if (activeOnly) query = query.Where(l => l.ReturnedAt == null);
        return await query.OrderByDescending(l => l.BorrowedAt)
            .Take(Math.Clamp(take, 1, 500))
            .ToListAsync();
    }

    public async Task<List<BatteryLoan>> GetMineAsync(int userId)
        => await _db.BatteryLoans.Include(l => l.Battery)
            .Where(l => l.UserId == userId && l.ReturnedAt == null)
            .OrderByDescending(l => l.BorrowedAt)
            .ToListAsync();

    /// <summary>
    /// 台账 CSV 导出（期末对账）：编码/型号/状态/健康度/当前借用人/借出时间/备注。
    /// CSV 公式注入防护同 LogService.Export（=+-@ 前缀加引号）。
    /// </summary>
    public async Task<string> ExportItemsCsvAsync(string? status = null)
    {
        var items = await GetAllAsync(status, null);
        static string Csv(string? v)
        {
            var s = v ?? "";
            if (s.Length > 0 && "=+-@\t\r".IndexOf(s[0]) >= 0) s = "'" + s;
            return $"\"{s.Replace("\"", "\"\"")}\"";
        }
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("编码,型号,状态,健康度,当前借用人,借出时间,备注");
        foreach (var b in items)
        {
            sb.AppendLine(string.Join(",",
                Csv(b.Code), Csv(b.Model), Csv(StatusText(b.Status)), Csv(b.Health),
                Csv(b.CurrentBorrower?.Username), Csv(b.BorrowedAt?.ToString("yyyy-MM-dd HH:mm")), Csv(b.Notes)));
        }
        return sb.ToString();
    }

    /// <summary>借还流水 CSV 导出：借用人/借出/归还人/归还/认定方式/备注。</summary>
    public async Task<string> ExportLoansCsvAsync(int take = 5000)
    {
        var loans = await GetLoansAsync(null, null, false, take);
        static string Csv(string? v)
        {
            var s = v ?? "";
            if (s.Length > 0 && "=+-@\t\r".IndexOf(s[0]) >= 0) s = "'" + s;
            return $"\"{s.Replace("\"", "\"\"")}\"";
        }
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("电池编码,借用人,借出时间,归还人,归还时间,认定方式,备注");
        foreach (var l in loans)
        {
            sb.AppendLine(string.Join(",",
                Csv(l.Battery?.Code), Csv(l.User?.Username), Csv(l.BorrowedAt.ToString("yyyy-MM-dd HH:mm")),
                Csv(l.ReturnedBy?.Username), Csv(l.ReturnedAt?.ToString("yyyy-MM-dd HH:mm")),
                Csv(l.AuthMethod), Csv(l.Note)));
        }
        return sb.ToString();
    }

    public async Task<List<BatteryLoan>> GetOverdueAsync(int hours)
    {
        var cutoff = DateTime.UtcNow.AddHours(-hours);
        return await _db.BatteryLoans.Include(l => l.Battery).Include(l => l.User)
            .Where(l => l.ReturnedAt == null && l.BorrowedAt < cutoff)
            .OrderBy(l => l.BorrowedAt)
            .ToListAsync();
    }
}
