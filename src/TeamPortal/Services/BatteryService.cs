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

    private static readonly string[] BorrowableStatuses = { StatusInStock };

    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly SettingsService _settings;

    public BatteryService(AppDbContext db, LogService log, SettingsService settings)
    {
        _db = db;
        _log = log;
        _settings = settings;
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
        return item;
    }

    public async Task<BatteryItem?> UpdateAsync(int id, string? model, string? status, string? health, string? notes, bool clearModel = false)
    {
        var item = await _db.BatteryItems.FindAsync(id);
        if (item is null) return null;

        EnsureLength(model, ModelMaxLength, "型号");
        EnsureLength(notes, NotesMaxLength, "备注");
        if (model is not null) item.Model = string.IsNullOrWhiteSpace(model) ? null : model.Trim();
        if (clearModel) item.Model = null;
        if (health is not null) item.Health = health;
        if (notes is not null) item.Notes = notes;
        if (status is not null)
        {
            // 借出/归还必须走借还接口；管理员只允许把电池手工置为不可借状态（或强制回库）
            if (status == StatusBorrowed)
                throw new InvalidOperationException("「借出」状态只能通过借出操作产生");
            if (status == StatusInStock && item.Status == StatusBorrowed)
            {
                // 强制回库：先把未归还流水补上，避免"在借但没记录"
                await CloseOpenLoanAsync(id, null, "管理员强制回库");
            }
            item.Status = status;
        }
        item.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return item;
    }

    /// <summary>借出：电池必须可用；返回新建的流水。</summary>
    public async Task<BatteryLoan> BorrowAsync(int batteryId, int borrowerId, string? note)
    {
        var item = await _db.BatteryItems.FindAsync(batteryId)
            ?? throw new InvalidOperationException("电池不存在");
        if (!BorrowableStatuses.Contains(item.Status))
            throw new InvalidOperationException($"电池当前状态为「{StatusText(item.Status)}」，不能借出");

        var now = DateTime.UtcNow;
        var loan = new BatteryLoan
        {
            BatteryId = batteryId,
            UserId = borrowerId,
            BorrowedAt = now,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
        };
        item.Status = StatusBorrowed;
        item.CurrentBorrowerId = borrowerId;
        item.BorrowedAt = now;
        item.UpdatedAt = now;
        _db.BatteryLoans.Add(loan);
        await _db.SaveChangesAsync();

        _log.Info("battery", $"Battery borrowed: {item.Code} -> user#{borrowerId}");
        return loan;
    }

    /// <summary>归还：电池必须处于借出状态；关闭未归还流水。</summary>
    public async Task<BatteryLoan> ReturnAsync(int batteryId, int operatorId, string? note)
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
        item.Status = StatusInStock;
        item.CurrentBorrowerId = null;
        item.BorrowedAt = null;
        item.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _log.Info("battery", $"Battery returned: {item.Code} by user#{operatorId}");
        return loan;
    }

    /// <summary>删除电池（仅管理员）：在借或存在未归还流水时拒绝，避免留下悬空责任。</summary>
    public async Task<bool> DeleteAsync(int id)
    {
        var item = await _db.BatteryItems.FindAsync(id);
        if (item is null) return false;

        if (item.Status == StatusBorrowed)
            throw new InvalidOperationException("电池在借出状态，请先归还再删除");
        var hasOpenLoan = await _db.BatteryLoans.AnyAsync(l => l.BatteryId == id && l.ReturnedAt == null);
        if (hasOpenLoan)
            throw new InvalidOperationException("电池还有未归还的借出记录，请先归还再删除");

        _db.BatteryItems.Remove(item);
        await _db.SaveChangesAsync();
        _log.Info("battery", $"Battery deleted: {item.Code}");
        return true;
    }

    /// <summary>字段长度校验（Trim 后）：超长抛 InvalidOperationException，由端点转 400。</summary>
    private static void EnsureLength(string? value, int max, string fieldName)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().Length > max)
            throw new InvalidOperationException($"{fieldName}不能超过 {max} 个字符");
    }

    private async Task CloseOpenLoanAsync(int batteryId, int? operatorId, string note)
    {
        var loan = await _db.BatteryLoans
            .Where(l => l.BatteryId == batteryId && l.ReturnedAt == null)
            .OrderByDescending(l => l.BorrowedAt)
            .FirstOrDefaultAsync();
        if (loan is not null) CloseLoan(loan, operatorId, note);
    }

    private static void CloseLoan(BatteryLoan loan, int? operatorId, string? note)
    {
        loan.ReturnedAt = DateTime.UtcNow;
        loan.ReturnedByUserId = operatorId;
        if (!string.IsNullOrWhiteSpace(note)) loan.Note = note.Trim();
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
