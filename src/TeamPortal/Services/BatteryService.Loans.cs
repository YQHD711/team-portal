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

    public async Task<List<BatteryLoan>> GetOverdueAsync(int hours)
    {
        var cutoff = DateTime.UtcNow.AddHours(-hours);
        return await _db.BatteryLoans.Include(l => l.Battery).Include(l => l.User)
            .Where(l => l.ReturnedAt == null && l.BorrowedAt < cutoff)
            .OrderBy(l => l.BorrowedAt)
            .ToListAsync();
    }
}
