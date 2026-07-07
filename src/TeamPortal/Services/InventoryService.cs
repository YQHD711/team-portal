using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class InventoryService
{
    public const int LowStockThreshold = 3;

    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly LogService _log;
    private readonly NotificationService _notification;
    private readonly HttpClient _http;

    public InventoryService(AppDbContext db, IConfiguration config, LogService log, NotificationService notification, HttpClient http)
    {
        _db = db; _config = config; _log = log; _notification = notification; _http = http;
    }

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

    public async Task<InventoryItem> Create(string name, string category, int quantity, string location, string status)
    {
        var item = new InventoryItem
        {
            Name = name,
            Category = category,
            Quantity = quantity,
            Location = location,
            Status = status,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.InventoryItems.Add(item);
        await _db.SaveChangesAsync();

        // 审计日志
        _log.Info("inventory", $"Part added: {name}", $"{{\"qty\":{quantity},\"cat\":\"{category}\"}}");

        // 低量告警
        if (quantity <= LowStockThreshold)
        {
            _notification.Notify("库存预警", $"零件「{name}」库存仅剩 {quantity} 件，请及时补货。");
        }

        return item;
    }

    public async Task<InventoryItem?> Update(int id, int? quantity, string? location, string? status)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return null;

        if (quantity.HasValue) item.Quantity = quantity.Value;
        if (location is not null) item.Location = location;
        if (status is not null) item.Status = status;
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

    public async Task<int> ImportFromExcel(string filePath)
    {
        var pythonUrl = _config["AiService:BaseUrl"] ?? "http://localhost:9001";
        var response = await _http.PostAsync(
            $"{pythonUrl}/api/parse/excel?filepath={Uri.EscapeDataString(filePath)}", null);

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(json);
        var items = doc.RootElement.GetProperty("items").EnumerateArray();

        var count = 0;
        foreach (var item in items)
        {
            var name = item.GetProperty("name").GetString() ?? "";
            var category = item.GetProperty("category").GetString() ?? "";
            var quantity = item.GetProperty("quantity").GetInt32();
            var location = item.GetProperty("location").GetString() ?? "";
            var status = item.GetProperty("status").GetString() ?? "available";

            _db.InventoryItems.Add(new InventoryItem
            {
                Name = name,
                Category = category,
                Quantity = quantity,
                Location = location,
                Status = status,
                UpdatedAt = DateTime.UtcNow,
            });

            // 低量告警
            if (quantity <= LowStockThreshold)
            {
                _notification.Notify("库存预警", $"导入零件「{name}」库存仅剩 {quantity} 件，请及时补货。");
            }

            count++;
        }
        await _db.SaveChangesAsync();

        // 审计日志
        _log.Info("inventory", $"Excel import completed", $"{{\"imported\":{count}}}");

        return count;
    }
}
