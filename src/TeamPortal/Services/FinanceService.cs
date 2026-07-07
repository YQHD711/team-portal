using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class FinanceService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly NotificationService _notif;

    public FinanceService(AppDbContext db, LogService log, NotificationService notif) { _db = db; _log = log; _notif = notif; }

    // ── Requests ──

    public async Task<PurchaseRequest> CreateRequest(int userId, string itemName, int quantity, decimal estimatedPrice, string reason)
    {
        var req = new PurchaseRequest
        {
            RequesterUserId = userId, ItemName = itemName, Quantity = quantity,
            EstimatedPrice = estimatedPrice, Reason = reason
        };
        _db.PurchaseRequests.Add(req);
        await _db.SaveChangesAsync();
        _log.Info("finance", $"Purchase request created: {itemName} x{quantity} ¥{estimatedPrice}");
        _notif.Notify("新的采购申请", $"{itemName} x{quantity} (¥{estimatedPrice})", "/finance");
        return req;
    }

    public async Task<List<PurchaseRequest>> GetRequests(string? status, int? userId, int page = 1)
    {
        var q = _db.PurchaseRequests.Include(r => r.Requester).Include(r => r.Approver).AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
        if (userId.HasValue) q = q.Where(r => r.RequesterUserId == userId);
        return await q.OrderByDescending(r => r.CreatedAt).Skip((page - 1) * 50).Take(50).ToListAsync();
    }

    public async Task<PurchaseRequest?> GetRequest(int id)
        => await _db.PurchaseRequests.Include(r => r.Requester).Include(r => r.Approver).FirstOrDefaultAsync(r => r.Id == id);

    public async Task<bool> Approve(int id, int approverId)
    {
        var req = await _db.PurchaseRequests.FindAsync(id);
        if (req is null || req.Status != "pending") return false;
        req.Status = "approved"; req.ApproverUserId = approverId; req.ApprovedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _log.Info("finance", $"Purchase request #{id} approved: {req.ItemName}");
        _notif.Notify("采购已批准", $"{req.ItemName} 已批准采购", "/finance", req.RequesterUserId);
        return true;
    }

    public async Task<bool> Reject(int id, int approverId, string reason)
    {
        var req = await _db.PurchaseRequests.FindAsync(id);
        if (req is null || req.Status != "pending") return false;
        req.Status = "rejected"; req.ApproverUserId = approverId; req.RejectReason = reason;
        await _db.SaveChangesAsync();
        _log.Warn("finance", $"Purchase request #{id} rejected: {req.ItemName} - {reason}");
        _notif.Notify("采购被拒绝", $"{req.ItemName}: {reason}", "/finance", req.RequesterUserId);
        return true;
    }

    public async Task<bool> MarkPurchased(int id, decimal actualPrice)
    {
        var req = await _db.PurchaseRequests.FindAsync(id);
        if (req is null || req.Status != "approved") return false;
        req.Status = "purchased"; req.ActualPrice = actualPrice; req.PurchasedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _log.Info("finance", $"Purchase #{id} marked as purchased: ¥{actualPrice}");
        return true;
    }

    public async Task<bool> MarkReceived(int id)
    {
        var req = await _db.PurchaseRequests.FindAsync(id);
        if (req is null || req.Status != "purchased") return false;
        req.Status = "received"; req.ReceivedAt = DateTime.UtcNow;

        // Auto-add to inventory
        var item = new InventoryItem
        {
            Name = req.ItemName, Quantity = req.Quantity,
            Status = "available", UpdatedAt = DateTime.UtcNow
        };
        _db.InventoryItems.Add(item);
        await _db.SaveChangesAsync();
        _log.Info("finance", $"Purchase #{id} received + inventory added: {req.ItemName} x{req.Quantity}");
        _notif.Notify("采购已入库", $"{req.ItemName} x{req.Quantity} 已入库", "/inventory");
        return true;
    }

    // ── Reports ──

    public async Task<object> GetMonthlyReport(int year, int month)
    {
        var start = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = start.AddMonths(1);

        var requests = await _db.PurchaseRequests
            .Where(r => r.CreatedAt >= start && r.CreatedAt < end)
            .Include(r => r.Requester)
            .ToListAsync();

        var approved = requests.Where(r => r.Status == "approved" || r.Status == "purchased" || r.Status == "received").ToList();
        var received = requests.Where(r => r.Status == "received").ToList();

        return new
        {
            year, month,
            totalRequests = requests.Count,
            approvedCount = approved.Count,
            receivedCount = received.Count,
            rejectedCount = requests.Count(r => r.Status == "rejected"),
            estimatedTotal = requests.Sum(r => r.EstimatedPrice),
            actualTotal = received.Sum(r => r.ActualPrice ?? r.EstimatedPrice),
            requests = requests.Select(r => new
            {
                r.Id, r.ItemName, r.Quantity, r.EstimatedPrice, r.ActualPrice, r.Status,
                Requester = r.Requester!.Username,
                r.CreatedAt, r.ApprovedAt, r.ReceivedAt
            })
        };
    }

    public async Task<object> GetStats()
    {
        var all = await _db.PurchaseRequests.ToListAsync();
        return new
        {
            pending = all.Count(r => r.Status == "pending"),
            approved = all.Count(r => r.Status == "approved"),
            purchased = all.Count(r => r.Status == "purchased"),
            received = all.Count(r => r.Status == "received"),
            totalSpent = all.Where(r => r.Status == "received").Sum(r => r.ActualPrice ?? r.EstimatedPrice),
            thisMonth = all.Count(r => r.CreatedAt >= new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc))
        };
    }
}
