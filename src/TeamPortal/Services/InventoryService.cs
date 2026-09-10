using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class InventoryService
{
    /// <summary>
    /// 低库存阈值兜底值：与 SettingsService 种子 `Inventory:LowStockThreshold` 保持一致。
    /// 真实取值一律走 <see cref="GetLowStockThresholdAsync"/>（设置页可改），
    /// 前端通过 GET /api/inventory/meta 拿同一个值 —— 阈值只有这一个来源。
    /// </summary>
    public const int DefaultLowStockThreshold = 5;

    /// <summary>根据单价自动判定物料等级：≥1000→A, 100~999→B, ＜100→C</summary>
    public static string CalcGrade(decimal unitPrice) => unitPrice switch
    {
        >= 1000 => "A",
        >= 100 => "B",
        _ => "C"
    };

    private readonly AppDbContext _db;
    private readonly LogService _log;
    private readonly NotificationService _notification;
    private readonly SettingsService _settings;

    public InventoryService(AppDbContext db, LogService log, NotificationService notification, SettingsService settings)
    {
        _db = db; _log = log; _notification = notification; _settings = settings;
    }

    /// <summary>低库存阈值（设置页 Inventory:LowStockThreshold，兜底 5）：仪表盘、库存页、通知共用</summary>
    public Task<int> GetLowStockThresholdAsync()
        => _settings.GetInt("Inventory:LowStockThreshold", DefaultLowStockThreshold);

    /// <summary>低库存判定：数量 &lt; 阈值（与前端显示口径一致）</summary>
    public static bool IsLowStock(int quantity, int threshold) => quantity < threshold;

    public async Task<List<InventoryItem>> GetAll(string? search, string? category)
    {
        var query = _db.InventoryItems.AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(i => i.Name.Contains(search));
        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(i => i.Category == category);

        return await query.OrderBy(i => i.Name).ToListAsync();
    }

    public async Task<InventoryItem?> GetById(int id)
    {
        return await _db.InventoryItems.FindAsync(id);
    }

    public async Task<InventoryItem> Create(string name, string category, int quantity,
        string grade = "C", decimal unitPrice = 0, int? departmentId = null, string? projectTag = null, string? locationCode = null)
    {
        var item = new InventoryItem
        {
            Name = name, Category = category, Quantity = quantity,
            Status = "available",
            Grade = unitPrice > 0 ? CalcGrade(unitPrice) : grade,
            UnitPrice = unitPrice, DepartmentId = departmentId,
            ProjectTag = projectTag, LocationCode = locationCode,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.InventoryItems.Add(item);
        await _db.SaveChangesAsync();

        // 审计日志
        _log.Info("inventory", $"Part added: {name}", $"{{\"qty\":{quantity},\"cat\":\"{category}\"}}");

        // 低量告警（阈值取自设置页，与仪表盘/库存页同一口径）
        var addThreshold = await GetLowStockThresholdAsync();
        if (IsLowStock(quantity, addThreshold))
        {
            _notification.Notify("库存预警", $"零件「{name}」库存仅剩 {quantity} 件（低于 {addThreshold} 件），请及时补货。");
        }

        return item;
    }

    public async Task<InventoryItem?> Update(int id,
        string? name = null, int? quantity = null, string? status = null,
        string? grade = null, decimal? unitPrice = null, int? departmentId = null, string? projectTag = null, string? locationCode = null)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return null;
        if (name is not null) item.Name = name;
        if (quantity.HasValue) item.Quantity = quantity.Value;
        if (status is not null) item.Status = status;
        if (unitPrice.HasValue) item.UnitPrice = unitPrice.Value;
        if (unitPrice.HasValue && grade is null)
            item.Grade = CalcGrade(unitPrice.Value);
        else if (grade is not null)
            item.Grade = grade;
        if (departmentId.HasValue) item.DepartmentId = departmentId.Value;
        if (projectTag is not null) item.ProjectTag = projectTag;
        if (locationCode is not null) item.LocationCode = locationCode;
        item.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return item;
    }

    public async Task SetPhoto(int id, string photoUrl)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return;
        item.PhotoUrl = photoUrl;
        item.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    public async Task<bool> Delete(int id)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return false;
        _db.InventoryItems.Remove(item);
        await _db.SaveChangesAsync();
        _log.Warn("inventory", $"Part deleted: {item.Name}");
        return true;
    }

    /// <summary>本地解析库存 Excel(.xlsx/.xlsm)并入库。原 ai-service openpyxl 转发已收编。
    /// 数据约定: 首行表头(名称/分类/数量/库位/状态), 自第 2 行起逐行导入。</summary>
    public async Task<int> ImportFromExcel(string filePath)
    {
        var count = 0;
        var importThreshold = await GetLowStockThresholdAsync();
        using var stream = File.OpenRead(filePath);
        foreach (var row in MiniExcelLibs.MiniExcel.Query(stream, useHeaderRow: true))
        {
            // MiniExcel 非泛型 Query 返回 ExpandoObject(实现 IDictionary<string,object>)
            if (row is not IDictionary<string, object> d || d.Count == 0) continue;

            string Get(string key) => d.TryGetValue(key, out var v) ? v?.ToString() ?? "" : "";
            // 兼容中英/中列名
            var name = Get("名称");     if (string.IsNullOrEmpty(name)) name = Get("Name");
            if (string.IsNullOrEmpty(name)) name = Get("name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            var category = FirstNonEmpty(Get("分类"), Get("Category"), Get("category"), "未分类");
            var quantityStr = Get("数量"); if (string.IsNullOrEmpty(quantityStr)) quantityStr = Get("Qty");
            if (string.IsNullOrEmpty(quantityStr)) quantityStr = Get("qty");
            int.TryParse(quantityStr, out var quantity);
            var locationCode = FirstNonEmpty(Get("库位"), Get("Location"), Get("location"), Get("LocationCode"), Get("位置"), "");
            var status = FirstNonEmpty(Get("状态"), Get("Status"), Get("status"), "available");
            var explicitGrade = FirstNonEmpty(Get("Grade"), Get("等级"), Get("grade"), "");
            var unitPriceStr = Get("单价"); if (string.IsNullOrEmpty(unitPriceStr)) unitPriceStr = Get("UnitPrice");
            decimal.TryParse(unitPriceStr, out var unitPrice);
            // Grade: 显式列优先;否则按单价自动判定(≥1000→A, 100~999→B, ＜100→C;无单价→C)
            var grade = string.IsNullOrEmpty(explicitGrade)
                ? (unitPrice > 0 ? CalcGrade(unitPrice) : "C")
                : explicitGrade;

            _db.InventoryItems.Add(new InventoryItem
            {
                Name = name,
                Category = category,
                Quantity = quantity,
                LocationCode = string.IsNullOrEmpty(locationCode) ? null : locationCode,
                Status = status,
                Grade = grade,
                UnitPrice = unitPrice,
                UpdatedAt = DateTime.UtcNow,
            });

            // 低量告警（整个导入批次用同一阈值，避免循环内反复读设置）
            if (IsLowStock(quantity, importThreshold))
                _notification.Notify("库存预警", $"导入零件「{name}」库存仅剩 {quantity} 件（低于 {importThreshold} 件），请及时补货。");

            count++;
        }
        await _db.SaveChangesAsync();

        // 审计日志
        _log.Info("inventory", $"Excel import completed", $"{{\"imported\":{count}}}");

        return count;
    }

    private static string FirstNonEmpty(params string[] values)
    {
        foreach (var v in values)
            if (!string.IsNullOrWhiteSpace(v)) return v;
        return "";
    }
}
