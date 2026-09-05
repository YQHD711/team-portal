using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public record StocktakeItemResult(int ItemId, int ActualQty, string? Note);

public class MaterialService
{
    private readonly AppDbContext _db;
    private readonly LogService? _log;
    private readonly NotificationService? _notify;

    public MaterialService(AppDbContext db, LogService? log = null, NotificationService? notify = null)
    {
        _db = db; _log = log; _notify = notify;
    }

    private async Task<string> GetUsername(int userId)
    {
        var u = await _db.Users.FindAsync(userId);
        return u?.Username ?? "未知";
    }

    public async Task<CheckoutRequest> CreateCheckout(int itemId, int userId, int quantity, string note, string? role = null)
    {
        var item = await _db.InventoryItems.FindAsync(itemId)
            ?? throw new InvalidOperationException("零件不存在");
        if (quantity <= 0) throw new InvalidOperationException("数量必须大于0");
        if (item.Quantity < quantity) throw new InvalidOperationException("库存不足");

        // 审批流转规则(以申请人所在部门为准):
        //  admin 自领用 → 直接放行(管理员即终审人)
        //  部长自领用   → A级 进管理员终审;B/C级 直接放行(部长即部长审审批人)
        //  普通成员 C级 → 自助放行(耗材)
        //  普通成员 A/B级 → 本部门有部长则部长审(A再进 admin 终审);
        //                   未分配部门 / 部门无部长 → 直接进管理员审批,避免无人可批
        var requester = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw new InvalidOperationException("用户不存在");
        role ??= requester.Role;
        var isAdminSelf = role == "admin";
        var isDeptHeadSelf = role == "部长";
        string status;
        if (isAdminSelf || item.Grade == "C") status = "approved";
        else if (isDeptHeadSelf) status = item.Grade == "A" ? "pending_admin" : "approved";
        else
        {
            var hasLeader = requester.DepartmentId.HasValue &&
                await _db.Users.AnyAsync(u => u.Role == "部长" && u.DepartmentId == requester.DepartmentId);
            status = hasLeader ? "pending_dept" : "pending_admin";
        }
        var req = new CheckoutRequest
        {
            InventoryItemId = itemId, RequesterUserId = userId, Quantity = quantity,
            Grade = item.Grade, Status = status, Note = note,
            CreatedAt = DateTime.UtcNow,
            ApprovedAt = status == "approved" ? DateTime.UtcNow : null,
        };

        if (status == "approved")
        {
            // 原子扣库存:单条 UPDATE 防并发丢更新;受影响行数为 0 即库存不足
            var updated = await _db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE InventoryItems SET Quantity = Quantity - {quantity},
Status = CASE WHEN Quantity - {quantity} <= 0 THEN 'in_use' ELSE Status END,
UpdatedAt = {DateTime.UtcNow} WHERE Id = {itemId} AND Quantity >= {quantity}");
            if (updated == 0) throw new InvalidOperationException("库存不足");
            _db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = itemId, Type = "checkout", Quantity = quantity,
                UserName = await GetUsername(userId), Note = note, CreatedAt = DateTime.UtcNow,
            });
        }
        _db.CheckoutRequests.Add(req);

        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Checkout #{req.Id}: {item.Name} -{quantity} [{item.Grade}] -> {status}");
        if (status == "pending_admin")
            _notify?.Notify("待管理员审批", $"「{item.Name}」({item.Grade}级) 申请 {quantity} 个", "/inventory/checkout", targetRole: "admin");
        else if (status == "pending_dept")
            _notify?.Notify("待审批领用", $"「{item.Name}」({item.Grade}级) 申请 {quantity} 个", "/inventory/checkout", targetRole: "staff");
        return req;
    }

    public async Task<CheckoutRequest?> ApproveDept(int requestId, int approverUserId)
    {
        var req = await _db.CheckoutRequests.Include(r => r.Item).FirstOrDefaultAsync(r => r.Id == requestId);
        if (req is null || req.Status != "pending_dept") return null;

        if (req.Grade == "B")
        {
            // 原子扣库存(B级批准即扣),失败抛库存不足
            var updated = await _db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE InventoryItems SET Quantity = Quantity - {req.Quantity},
Status = CASE WHEN Quantity - {req.Quantity} <= 0 THEN 'in_use' ELSE Status END,
UpdatedAt = {DateTime.UtcNow} WHERE Id = {req.InventoryItemId} AND Quantity >= {req.Quantity}");
            if (updated == 0) throw new InvalidOperationException("库存不足");
            req.Status = "approved"; req.ApprovedAt = DateTime.UtcNow; req.DeptApproverUserId = approverUserId;
            _db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = req.InventoryItemId, Type = "checkout", Quantity = req.Quantity,
                UserName = await GetUsername(req.RequesterUserId), Note = req.Note, CreatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            req.Status = "pending_admin"; req.DeptApproverUserId = approverUserId;
            _notify?.Notify("待管理员审批", $"「{req.Item?.Name}」(A级) 需终审", "/inventory/checkout", targetRole: "admin");
        }

        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Checkout #{requestId} dept-ok -> {req.Status}");
        return req;
    }

    public async Task<CheckoutRequest?> ApproveAdmin(int requestId, int approverUserId)
    {
        var req = await _db.CheckoutRequests.Include(r => r.Item).FirstOrDefaultAsync(r => r.Id == requestId);
        // 无部门/部门无部长的 A/B 级申请直接在此一次性通过(不再要求先经部长审)
        if (req is null || req.Status != "pending_admin") return null;
        req.Status = "approved"; req.ApprovedAt = DateTime.UtcNow; req.AdminApproverUserId = approverUserId;
        var item = req.Item!;
        // 原子扣库存(A级终审即扣),失败抛库存不足
        var updated = await _db.Database.ExecuteSqlInterpolatedAsync(
            $@"UPDATE InventoryItems SET Quantity = Quantity - {req.Quantity},
Status = CASE WHEN Quantity - {req.Quantity} <= 0 THEN 'in_use' ELSE Status END,
UpdatedAt = {DateTime.UtcNow} WHERE Id = {req.InventoryItemId} AND Quantity >= {req.Quantity}");
        if (updated == 0) throw new InvalidOperationException("库存不足");
        _db.InventoryTransactions.Add(new InventoryTransaction
        {
            InventoryItemId = req.InventoryItemId, Type = "checkout", Quantity = req.Quantity,
            UserName = await GetUsername(req.RequesterUserId), Note = req.Note, CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Checkout #{requestId} admin-ok");
        _notify?.Notify("领用已批准", $"「{item.Name}」(A级) 已通过", "/inventory/checkout", userId: req.RequesterUserId);
        return req;
    }

    public async Task<CheckoutRequest?> RejectRequest(int requestId, int approverUserId, string reason)
    {
        var req = await _db.CheckoutRequests.Include(r => r.Item).FirstOrDefaultAsync(r => r.Id == requestId);
        if (req is null || req.Status is "approved" or "rejected" or "returned") return null;
        req.Status = "rejected"; req.RejectReason = reason;
        await _db.SaveChangesAsync();
        _log?.Warn("inventory", $"Checkout #{requestId} rejected: {reason}");
        _notify?.Notify("领用已驳回", $"「{req.Item?.Name}」: {reason}", "/inventory/checkout", userId: req.RequesterUserId);
        return req;
    }

    public async Task<List<CheckoutRequest>> GetMyRequests(int userId) =>
        await _db.CheckoutRequests.Include(r => r.Item).Include(r => r.Checkin)
            .Where(r => r.RequesterUserId == userId)
            .OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync();

    public async Task<List<CheckoutRequest>> GetPendingRequests(string? role, int? userId, int? departmentId)
    {
        var q = _db.CheckoutRequests.Include(r => r.Item).Include(r => r.Requester).AsQueryable();
        if (role == "admin") q = q.Where(r => r.Status == "pending_admin");
        else if (role == "部长" && departmentId.HasValue)
            q = q.Where(r => r.Status == "pending_dept" && r.Requester!.DepartmentId == departmentId);
        else return new();
        return await q.OrderByDescending(r => r.CreatedAt).ToListAsync();
    }

    public async Task<CheckoutRequest?> GetRequest(int id) =>
        await _db.CheckoutRequests.Include(r => r.Item).Include(r => r.Requester)
            .Include(r => r.DeptApprover).Include(r => r.AdminApprover).Include(r => r.Checkin)
            .FirstOrDefaultAsync(r => r.Id == id);

    public async Task<CheckinRecord?> Checkin(int requestId, int checkedByUserId,
        string condition, bool hasPhoto, string? testNotes, string? photoUrl)
    {
        var req = await _db.CheckoutRequests.Include(r => r.Item).FirstOrDefaultAsync(r => r.Id == requestId);
        if (req is null || req.Status != "approved") return null;
        if (req.Grade == "A" && !hasPhoto) throw new InvalidOperationException("A级物料归还必须上传照片");

        req.Status = "returned"; req.ReturnedAt = DateTime.UtcNow;
        var item = req.Item!;
        // 原子加库存并恢复状态(损坏→broken,否则→available),防并发丢更新
        var status = condition == "damaged" ? "broken" : "available";
        var updated = await _db.Database.ExecuteSqlInterpolatedAsync(
            $@"UPDATE InventoryItems SET Quantity = Quantity + {req.Quantity}, Status = {status},
UpdatedAt = {DateTime.UtcNow} WHERE Id = {req.InventoryItemId}");
        if (updated == 0) throw new InvalidOperationException("零件不存在");
        _db.InventoryTransactions.Add(new InventoryTransaction
        {
            InventoryItemId = req.InventoryItemId, Type = "checkin", Quantity = req.Quantity,
            UserName = await GetUsername(checkedByUserId), Note = condition == "damaged" ? "有损坏" : "完好", CreatedAt = DateTime.UtcNow,
        });
        var record = new CheckinRecord
        {
            CheckoutRequestId = requestId, Condition = condition, HasPhoto = hasPhoto,
            TestNotes = testNotes, PhotoUrl = photoUrl, CheckedByUserId = checkedByUserId, CreatedAt = DateTime.UtcNow,
        };
        _db.CheckinRecords.Add(record);
        if (condition == "damaged")
        {
            _log?.Warn("inventory", $"Damaged return: {item.Name}");
            _notify?.Notify("损坏归还", $"「{item.Name}」归还损坏", "/inventory/checkout", targetRole: "admin");
        }
        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Checkin: {item.Name} +{req.Quantity} [checkout #{requestId}]");
        return record;
    }

    // ── Stocktake ──

    public async Task<Stocktake> StartStocktake(string type, string grade, int createdByUserId)
    {
        var st = new Stocktake { Type = type, Grade = grade, Status = "in_progress", CreatedByUserId = createdByUserId, StartedAt = DateTime.UtcNow };
        _db.Stocktakes.Add(st);
        var items = await _db.InventoryItems.Where(i => i.Grade == grade).OrderBy(i => i.Name).ToListAsync();
        foreach (var item in items) st.Items.Add(new StocktakeItem { InventoryItemId = item.Id, SystemQty = item.Quantity });
        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Stocktake started: {type}/{grade}, {items.Count} items");
        return st;
    }

    public async Task<List<Stocktake>> GetStocktakes() =>
        await _db.Stocktakes.Include(s => s.CreatedBy).OrderByDescending(s => s.StartedAt).Take(50).ToListAsync();

    public async Task<Stocktake?> GetStocktake(int id) =>
        await _db.Stocktakes.Include(s => s.Items).ThenInclude(si => si.InventoryItem)
            .Include(s => s.Items).ThenInclude(si => si.CheckedBy).Include(s => s.CreatedBy)
            .FirstOrDefaultAsync(s => s.Id == id);

    public async Task<StocktakeItem?> UpdateStocktakeItem(int stocktakeId, int itemId, int? actualQty, string? note, int checkedByUserId)
    {
        var si = await _db.StocktakeItems.FirstOrDefaultAsync(s => s.StocktakeId == stocktakeId && s.InventoryItemId == itemId);
        if (si is null) return null;
        si.ActualQty = actualQty; si.Difference = actualQty.HasValue ? actualQty.Value - si.SystemQty : null;
        si.Note = note; si.CheckedByUserId = checkedByUserId;
        await _db.SaveChangesAsync();
        return si;
    }

    public async Task<Stocktake?> CompleteStocktake(int id)
    {
        var st = await _db.Stocktakes.Include(s => s.Items).ThenInclude(si => si.InventoryItem).FirstOrDefaultAsync(s => s.Id == id);
        if (st is null || st.Status == "completed") return null;
        foreach (var si in st.Items.Where(x => x.Difference != 0 && x.ActualQty.HasValue))
        {
            si.InventoryItem!.Quantity = si.ActualQty!.Value; si.InventoryItem.UpdatedAt = DateTime.UtcNow;
            _db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = si.InventoryItemId, Type = si.Difference > 0 ? "checkin" : "checkout",
                Quantity = Math.Abs(si.Difference!.Value), UserName = "",
                Note = $"[盘点调整] 系统:{si.SystemQty} 实盘:{si.ActualQty}", CreatedAt = DateTime.UtcNow,
            });
        }
        st.Status = "completed"; st.CompletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var diffCount = st.Items.Count(x => x.Difference != 0);
        _log?.Info("inventory", $"Stocktake #{id} completed, {diffCount} diffs");
        _notify?.Notify("盘点完成", $"「{st.Type}/{st.Grade}」盘点已完成，{diffCount} 项差异已入账", "/inventory/stocktake", targetRole: "staff");
        return st;
    }

    public async Task AssignStocktakeItems(int stocktakeId, Dictionary<int, int> itemUserMap)
    {
        // 性能 #3:预加载所有相关项,内存匹配 → 100 项从 100 次查询降为 1 次
        if (itemUserMap.Count == 0) return;
        var itemIds = itemUserMap.Keys.ToList();
        var items = await _db.StocktakeItems
            .Where(s => s.StocktakeId == stocktakeId && itemIds.Contains(s.InventoryItemId))
            .ToListAsync();
        var byItemId = items.ToDictionary(s => s.InventoryItemId);
        foreach (var kv in itemUserMap)
        {
            if (byItemId.TryGetValue(kv.Key, out var si))
                si.CheckedByUserId = kv.Value;
        }
        await _db.SaveChangesAsync();
    }

    public async Task AutoAssignStocktake(int stocktakeId, List<int> userIds)
    {
        var items = await _db.StocktakeItems.Where(s => s.StocktakeId == stocktakeId).ToListAsync();
        var shuffled = items.OrderBy(_ => Random.Shared.Next()).ToList();
        var counts = new Dictionary<int, int>();
        for (int i = 0; i < shuffled.Count; i++)
        {
            var uid = userIds[i % userIds.Count];
            shuffled[i].CheckedByUserId = uid;
            counts[uid] = counts.GetValueOrDefault(uid) + 1;
        }
        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Stocktake #{stocktakeId}: auto {items.Count} items -> {userIds.Count} members");
        // Notify each assigned member
        foreach (var (uid, count) in counts)
            _notify?.Notify("盘点任务", $"你被分配了 {count} 项盘点任务，请尽快完成", "/inventory/stocktake", userId: uid);
    }

    public async Task<List<StocktakeItem>> GetMyStocktakeTasks(int userId) =>
        await _db.StocktakeItems.Include(si => si.InventoryItem).Include(si => si.Stocktake)
            .Where(si => si.CheckedByUserId == userId && si.ActualQty == null && si.Stocktake!.Status == "in_progress")
            .OrderBy(si => si.InventoryItem!.Name).ToListAsync();

    public async Task BatchCheckStocktakeItems(int stocktakeId, int userId, List<StocktakeItemResult> results)
    {
        // 性能 #3:预加载 + 内存匹配 → 100 项从 100 次查询降为 1 次
        if (results.Count == 0) { /* fall through to count */ }
        else
        {
            var itemIds = results.Select(r => r.ItemId).ToList();
            var items = await _db.StocktakeItems
                .Where(s => s.StocktakeId == stocktakeId && itemIds.Contains(s.InventoryItemId))
                .ToListAsync();
            var byItemId = items.ToDictionary(s => s.InventoryItemId);
            foreach (var r in results)
            {
                if (!byItemId.TryGetValue(r.ItemId, out var si) || si.CheckedByUserId != userId) continue;
                si.ActualQty = r.ActualQty; si.Difference = r.ActualQty - si.SystemQty; si.Note = r.Note;
            }
            await _db.SaveChangesAsync();
        }

        // Check if all items are now submitted
        var totalItems = await _db.StocktakeItems.CountAsync(si => si.StocktakeId == stocktakeId);
        var doneItems = await _db.StocktakeItems.CountAsync(si => si.StocktakeId == stocktakeId && si.ActualQty != null);
        if (doneItems == totalItems)
        {
            var st = await _db.Stocktakes.FindAsync(stocktakeId);
            _notify?.Notify("盘点就绪", $"「{st?.Type}/{st?.Grade}」全部 {totalItems} 项已提交，可完成盘点", "/inventory/stocktake", targetRole: "staff");
        }
    }

    // ── Damage ──

    public async Task<DamageReport> CreateDamageReport(int itemId, int userId, string type, string description, bool isApprovedTest)
    {
        var r = new DamageReport { InventoryItemId = itemId, UserId = userId, Type = type, Description = description, IsApprovedTest = isApprovedTest, Liability = "pending", CreatedAt = DateTime.UtcNow };
        _db.DamageReports.Add(r);
        var item = await _db.InventoryItems.FindAsync(itemId);
        if (item != null && type == "damage") { item.Status = "broken"; item.UpdatedAt = DateTime.UtcNow; }
        await _db.SaveChangesAsync();
        _log?.Warn("inventory", $"Damage: {item?.Name} {type}");
        _notify?.Notify("损坏报备", $"「{item?.Name}」{type}", "/inventory/damage", targetRole: "admin");
        return r;
    }

    public async Task<List<DamageReport>> GetDamageReports(int? itemId = null)
    {
        var q = _db.DamageReports.Include(d => d.Item).Include(d => d.User).AsQueryable();
        if (itemId.HasValue) q = q.Where(d => d.InventoryItemId == itemId.Value);
        return await q.OrderByDescending(d => d.CreatedAt).Take(200).ToListAsync();
    }

    public async Task<DamageReport?> ResolveDamageReport(int id, string liability, decimal? compensationAmount, string? resolution)
    {
        var r = await _db.DamageReports.Include(d => d.Item).FirstOrDefaultAsync(d => d.Id == id);
        if (r is null) return null;
        r.Liability = liability; r.CompensationAmount = compensationAmount; r.Resolution = resolution;
        await _db.SaveChangesAsync();
        _log?.Info("inventory", $"Damage #{id} resolved: {liability}");
        _notify?.Notify("定责完成", $"「{r.Item?.Name}」: {liability}", "/inventory/damage", userId: r.UserId);
        return r;
    }
}
