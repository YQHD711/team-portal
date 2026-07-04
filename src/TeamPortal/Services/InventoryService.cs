using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class InventoryService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;

    public InventoryService(AppDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
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
        };
        _db.InventoryItems.Add(item);
        await _db.SaveChangesAsync();
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

    public async Task<bool> Delete(int id)
    {
        var item = await _db.InventoryItems.FindAsync(id);
        if (item is null) return false;

        _db.InventoryItems.Remove(item);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<int> ImportFromExcel(string filePath)
    {
        var pythonUrl = _config["AiService:BaseUrl"] ?? "http://localhost:9001";
        using var client = new HttpClient();
        var response = await client.PostAsync(
            $"{pythonUrl}/api/parse/excel?filepath={Uri.EscapeDataString(filePath)}", null);

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(json);
        var items = doc.RootElement.GetProperty("items").EnumerateArray();

        var count = 0;
        foreach (var item in items)
        {
            _db.InventoryItems.Add(new InventoryItem
            {
                Name = item.GetProperty("name").GetString() ?? "",
                Category = item.GetProperty("category").GetString() ?? "",
                Quantity = item.GetProperty("quantity").GetInt32(),
                Location = item.GetProperty("location").GetString() ?? "",
                Status = item.GetProperty("status").GetString() ?? "available",
            });
            count++;
        }
        await _db.SaveChangesAsync();
        return count;
    }
}
