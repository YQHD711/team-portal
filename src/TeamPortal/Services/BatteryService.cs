using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 电池借还服务（核心状态机）。
///
/// 电池是单件资产：每块一条 BatteryItem，借还一次写一条 BatteryLoan。
/// 免审批；代借/代还由端点层鉴权后传入 borrowerId。
/// </summary>
public partial class BatteryService
{
    public const string StatusInStock = "in_stock";
    public const string StatusBorrowed = "borrowed";

    /// <summary>字段长度上限：与 EF MaxLength 及前端展示一致，超长直接 400（SQLite 不强制长度）。</summary>
    public const int CodeMaxLength = 50;
    public const int ModelMaxLength = 100;
    public const int NotesMaxLength = 500;
    public const int HealthMaxLength = 20;

    private static readonly string[] BorrowableStatuses = { StatusInStock };

    /// <summary>管理员可直接设置的状态（借出只能走借出接口，故不含 borrowed）。</summary>
    private static readonly string[] AllowedAdminStatuses = { StatusInStock, "charging", "repair", "retired" };

    /// <summary>禁止借出的健康度：热失控前兆/已损坏，任何状态都不可借。</summary>
    public static readonly string[] UnsafeHealths = { "鼓包", "漏液", "报废" };

    /// <summary>归还时声明的异常健康度：回库即转维修（含过放——回充检查后再上机）。</summary>
    public static readonly string[] AbnormalHealths = { "鼓包", "漏液", "过放", "报废" };

    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly NotificationService? _notify;

    public BatteryService(AppDbContext db, LogService log, SettingsService settings, NotificationService? notify = null)
    {
        _db = db;
        _log = log;
        _settings = settings;
        _notify = notify;
    }

    /// <summary>超时阈值（小时）：设置页 Battery:OverdueHours，兜底 24。</summary>
    public Task<int> GetOverdueHoursAsync() => _settings.GetInt("Battery:OverdueHours", 24);

    public async Task<List<BatteryItem>> GetAllAsync(string? status, string? search)
    {
        var query = _db.BatteryItems.Include(b => b.CurrentBorrower).AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(b => b.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            var upper = s.ToUpperInvariant();
            query = query.Where(b =>
                (b.Code != null && b.Code.Contains(upper)) ||
                (b.Model != null && b.Model.Contains(s)));
        }
        return await query.OrderBy(b => b.Code).ToListAsync();
    }

    public async Task<BatteryItem?> GetByIdAsync(int id)
        => await _db.BatteryItems.Include(b => b.CurrentBorrower).FirstOrDefaultAsync(b => b.Id == id);

    public async Task<BatteryItem?> GetByCodeAsync(string code)
    {
        var upper = (code ?? "").Trim().ToUpperInvariant();
        return await _db.BatteryItems.Include(b => b.CurrentBorrower)
            .FirstOrDefaultAsync(b => b.Code == upper);
    }

    /// <summary>下一个可用码：BAT-0001、BAT-0002……（取现有最大序号 +1，不因删除回退）。</summary>
    public async Task<string> NextCodeAsync()
    {
        var codes = await _db.BatteryItems.AsNoTracking()
            .Where(b => b.Code.StartsWith("BAT-"))
            .Select(b => b.Code)
            .ToListAsync();
        var max = codes
            .Select(c => int.TryParse(c["BAT-".Length..], out var n) ? n : 0)
            .DefaultIfEmpty(0)
            .Max();
        return $"BAT-{max + 1:D4}";
    }

    public async Task<BatteryItem> CreateAsync(string? code, string? model, string? health, string? notes)
    {
        var normalized = string.IsNullOrWhiteSpace(code)
            ? await NextCodeAsync()
            : code.Trim().ToUpperInvariant();

        if (await _db.BatteryItems.AnyAsync(b => b.Code == normalized))
            throw new InvalidOperationException($"编码 {normalized} 已存在");

        if (normalized.Length > CodeMaxLength)
            throw new InvalidOperationException($"编码不能超过 {CodeMaxLength} 个字符");
        EnsureLength(model, ModelMaxLength, "型号");
        EnsureLength(health, HealthMaxLength, "健康度");
        EnsureLength(notes, NotesMaxLength, "备注");

        var item = new BatteryItem
        {
            Code = normalized,
            Model = string.IsNullOrWhiteSpace(model) ? null : model.Trim(),
            Health = string.IsNullOrWhiteSpace(health) ? "正常" : health.Trim(),
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
            Status = StatusInStock,
        };
        _db.BatteryItems.Add(item);
        await _db.SaveChangesAsync();
        _log.Info("battery", $"Battery added: {item.Code} {item.Model}");
        await SyncInventoryCountAsync();
        return item;
    }

    public async Task<BatteryItem?> UpdateAsync(int id, string? model, string? status, string? health, string? notes, bool clearModel = false)
    {
        var item = await _db.BatteryItems.FindAsync(id);
        if (item is null) return null;

        EnsureLength(model, ModelMaxLength, "型号");
        EnsureLength(health, HealthMaxLength, "健康度");
        EnsureLength(notes, NotesMaxLength, "备注");
        if (model is not null) item.Model = string.IsNullOrWhiteSpace(model) ? null : model.Trim();
        if (clearModel) item.Model = null;
        if (health is not null) item.Health = string.IsNullOrWhiteSpace(health) ? null : health.Trim();
        // 空串 = 清空备注（与 model 语义一致）
        if (notes is not null) item.Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        if (status is not null)
        {
            // 状态白名单：防 garbage 等非法值把电池写成永久不可借
            if (!AllowedAdminStatuses.Contains(status))
                throw new InvalidOperationException("非法状态，可选：in_stock / charging / repair / retired");
            // 借出/归还必须走借还接口；管理员只允许把电池手工置为不可借状态（或强制回库）
            if (status == StatusBorrowed)
                throw new InvalidOperationException("「借出」状态只能通过借出操作产生");
            if (item.Status == StatusBorrowed)
            {
                // 从 borrowed 转出（含强制回库）：先关全部未归还流水并清借用字段，
                // 否则产生"流水未关但电池非借出"的悬空台账
                await CloseOpenLoansAsync(id, null,
                    status == StatusInStock ? "管理员强制回库" : "管理员改为「" + StatusText(status) + "」");
                item.CurrentBorrowerId = null;
                item.BorrowedAt = null;
            }
            item.Status = status;
        }
        item.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await SyncInventoryCountAsync();
        return item;
    }

    /// <summary>
    /// 借出：电池必须可用；返回新建的流水。
    ///
    /// 并发防护：用**条件更新抢占**（UPDATE ... WHERE Status='in_stock'），
    /// 抢不到的请求直接 409 —— 两个并发请求只会有一个成功，杜绝双借双流水。
    /// </summary>
    public async Task<BatteryLoan> BorrowAsync(int batteryId, int borrowerId, string? note, string? authMethod = null)
    {
        EnsureLength(note, NotesMaxLength, "备注");
        var now = DateTime.UtcNow;

        // 健康度禁借：鼓包/漏液/报废是热失控前兆，任何状态都不该进飞机 ——
        // 写进条件更新的 WHERE（原子拦截），与状态检查同一道闸
        var affected = await _db.BatteryItems
            .Where(b => b.Id == batteryId && b.Status == StatusInStock
                && (b.Health == null || !UnsafeHealths.Contains(b.Health)))
            .ExecuteUpdateAsync(s => s
                .SetProperty(b => b.Status, StatusBorrowed)
                .SetProperty(b => b.CurrentBorrowerId, borrowerId)
                .SetProperty(b => b.BorrowedAt, now)
                .SetProperty(b => b.UpdatedAt, now));
        if (affected == 0)
        {
            var current = await _db.BatteryItems.FindAsync(batteryId)
                ?? throw new InvalidOperationException("电池不存在");
            if (current.Health != null && UnsafeHealths.Contains(current.Health))
                throw new InvalidOperationException($"电池健康度为「{current.Health}」，禁止借出（请送检或退役）");
            throw new InvalidOperationException($"电池当前状态为「{StatusText(current.Status)}」，不能借出");
        }

        var loan = new BatteryLoan
        {
            BatteryId = batteryId,
            UserId = borrowerId,
            BorrowedAt = now,
            AuthMethod = authMethod,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
        };
        _db.BatteryLoans.Add(loan);
        await _db.SaveChangesAsync();

        _log.Info("battery", $"Battery borrowed: #{batteryId} -> user#{borrowerId}");
        await SyncInventoryCountAsync();
        return loan;
    }

    /// <summary>
    /// 归还：电池必须处于借出状态；关闭未归还流水。
    ///
    /// 归还健康检查（补责任链断点）：归还时声明健康度，异常（鼓包/漏液/过放/报废）
    /// 自动转维修禁借并通知管理员 —— 坏电池不再静默回库。
    /// </summary>
    public async Task<BatteryLoan> ReturnAsync(int batteryId, int operatorId, string? note, string? health = null)
    {
        var item = await _db.BatteryItems.FindAsync(batteryId)
            ?? throw new InvalidOperationException("电池不存在");
        if (item.Status != StatusBorrowed)
            throw new InvalidOperationException("电池当前不在借出状态，无需归还");

        var loan = await _db.BatteryLoans
            .Where(l => l.BatteryId == batteryId && l.ReturnedAt == null)
            .OrderByDescending(l => l.BorrowedAt)
            .FirstOrDefaultAsync()
            ?? throw new InvalidOperationException("找不到未归还的借出记录，请先核对台账");

        CloseLoan(loan, operatorId, note);
        var abnormal = !string.IsNullOrWhiteSpace(health) && AbnormalHealths.Contains(health.Trim());
        item.Health = string.IsNullOrWhiteSpace(health) ? item.Health : health.Trim();
        item.Status = abnormal ? "repair" : StatusInStock;
        item.CurrentBorrowerId = null;
        item.BorrowedAt = null;
        item.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        if (abnormal)
            _notify?.Notify("电池归还异常",
                $"「{item.Code}」归还时健康度为「{item.Health}」，已自动转维修禁借，请尽快检查",
                "/batteries", targetRole: "staff", level: "warning");
        _log.Info("battery", $"Battery returned: {item.Code} by user#{operatorId} (health={item.Health}, status={item.Status})");
        await SyncInventoryCountAsync();
        return loan;
    }

    /// <summary>删除电池（仅管理员）：在借或存在未归还流水时拒绝，避免留下悬空责任。</summary>
    public async Task<bool> DeleteAsync(int id)
    {
        var item = await _db.BatteryItems.FindAsync(id);
        if (item is null) return false;

        if (item.Status == StatusBorrowed)
            throw new InvalidOperationException("电池在借出状态，请先归还再删除");
        // 历史流水也是追责证据（外键 Restrict）：有借还记录的电池只能退役，不能物理删除
        var hasAnyLoan = await _db.BatteryLoans.AnyAsync(l => l.BatteryId == id);
        if (hasAnyLoan)
            throw new InvalidOperationException("该电池有借还历史记录，不能删除；请改为标记退役（状态=retired）");

        _db.BatteryItems.Remove(item);
        await _db.SaveChangesAsync();
        _log.Info("battery", $"Battery deleted: {item.Code}");
        await SyncInventoryCountAsync();
        return true;
    }

    /// <summary>
    /// 把电池台账「在库数」同步到物料表汇总条目（数量对账）。
    ///
    /// 关联条目由设置项 Battery:InventoryItemCode 指定（物料编码），未配置则跳过。
    /// 同步口径 = status=in_stock 的电池数（借出/充电/维修/退役都不算在库）。
    /// 物料条目是数量型汇总，电池台账才是单件主数据——方向永远是台账 → 物料，不反向。
    /// </summary>
    public async Task SyncInventoryCountAsync()
    {
        var code = await _settings.Get("Battery:InventoryItemCode", "");
        if (string.IsNullOrWhiteSpace(code)) return;

        var item = await _db.InventoryItems.FirstOrDefaultAsync(i => i.Code == code.Trim().ToUpperInvariant());
        if (item is null) return;

        var inStock = await _db.BatteryItems.CountAsync(b => b.Status == StatusInStock);
        if (item.Quantity == inStock) return;

        // 同步写一条调整流水：否则 Quantity 被覆盖写后与 InventoryTransactions 永远对不上账
        var delta = inStock - item.Quantity;
        item.Quantity = inStock;
        item.UpdatedAt = DateTime.UtcNow;
        _db.InventoryTransactions.Add(new InventoryTransaction
        {
            InventoryItemId = item.Id,
            Type = "sync",
            Quantity = Math.Abs(delta),
            UserName = "system:battery-sync",
            Note = delta > 0 ? $"电池在库数同步 +{delta}" : $"电池在库数同步 {delta}",
        });
        await _db.SaveChangesAsync();
        _log.Info("battery", $"Battery inventory synced: {item.Code} quantity={inStock}");
    }

    /// <summary>字段长度校验（Trim 后）：超长抛 InvalidOperationException，由端点转 400。</summary>
    private static void EnsureLength(string? value, int max, string fieldName)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().Length > max)
            throw new InvalidOperationException($"{fieldName}不能超过 {max} 个字符");
    }

    /// <summary>关闭该电池**全部**未归还流水（不止最新一条——并发/历史悬空都要清干净）。</summary>
    private async Task CloseOpenLoansAsync(int batteryId, int? operatorId, string note)
    {
        var loans = await _db.BatteryLoans
            .Where(l => l.BatteryId == batteryId && l.ReturnedAt == null)
            .ToListAsync();
        foreach (var loan in loans) CloseLoan(loan, operatorId, note);
    }

    private static void CloseLoan(BatteryLoan loan, int? operatorId, string? note)
    {
        loan.ReturnedAt = DateTime.UtcNow;
        loan.ReturnedByUserId = operatorId;
        // 备注**追加**而非覆盖：强制回库等操作不应抹掉原始借出备注
        var addition = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (addition is not null)
        {
            EnsureLength(addition, NotesMaxLength, "备注");
            loan.Note = string.IsNullOrWhiteSpace(loan.Note)
                ? addition
                : loan.Note + " | " + addition;
        }
    }

    public static string StatusText(string status) => status switch
    {
        StatusInStock => "在库",
        StatusBorrowed => "借出",
        "charging" => "充电中",
        "repair" => "维修中",
        "retired" => "已退役",
        _ => status,
    };
}
