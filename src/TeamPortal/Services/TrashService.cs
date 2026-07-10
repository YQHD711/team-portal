using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class TrashService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    public TrashService(AppDbContext db, LogService log) { _db = db; _log = log; }

    public async Task<TrashItem> MoveToTrash(string table, int originalId, string title, object data, int userId, string userName)
    {
        var item = new TrashItem
        {
            OriginalTable = table, OriginalId = originalId, Title = title,
            DataJson = JsonSerializer.Serialize(data),
            DeletedByUserId = userId, DeletedByName = userName
        };
        _db.TrashItems.Add(item);
        await _db.SaveChangesAsync();
        _log.Info("trash", $"Moved to trash: {title} ({table}#{originalId})");
        return item;
    }

    public async Task<List<TrashItem>> GetTrashItems(int page = 1, int pageSize = 50)
        => await _db.TrashItems.OrderByDescending(t => t.DeletedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

    public async Task<TrashItem?> GetTrashItem(long id)
        => await _db.TrashItems.FindAsync(id);

    public async Task<bool> Restore(long id)
    {
        var item = await _db.TrashItems.FindAsync(id);
        if (item is null) return false;

        // Restore based on table type
        try
        {
            switch (item.OriginalTable)
            {
                case "InventoryItem":
                    var inv = JsonSerializer.Deserialize<InventoryItem>(item.DataJson);
                    if (inv is not null) { inv.Id = 0; _db.InventoryItems.Add(inv); }
                    break;
                case "BatteryRecord":
                    var bat = JsonSerializer.Deserialize<BatteryRecord>(item.DataJson);
                    if (bat is not null) { bat.Id = 0; _db.BatteryRecords.Add(bat); }
                    break;
                case "IncidentRecord":
                    var inc = JsonSerializer.Deserialize<IncidentRecord>(item.DataJson);
                    if (inc is not null) { inc.Id = 0; _db.IncidentRecords.Add(inc); }
                    break;
                default:
                    return false;
            }
            _db.TrashItems.Remove(item);
            await _db.SaveChangesAsync();
            _log.Info("trash", $"Restored: {item.Title}");
            return true;
        }
        catch { return false; }
    }

    public async Task<bool> DeleteForever(long id)
    {
        var item = await _db.TrashItems.FindAsync(id);
        if (item is null) return false;
        _db.TrashItems.Remove(item);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<int> CleanupOld(int retentionDays = 30)
    {
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);
        var old = await _db.TrashItems.Where(t => t.DeletedAt < cutoff).ToListAsync();
        _db.TrashItems.RemoveRange(old);
        await _db.SaveChangesAsync();
        return old.Count;
    }
}
