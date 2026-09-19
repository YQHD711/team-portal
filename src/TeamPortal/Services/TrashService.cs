using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class TrashService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    private readonly BackupService _backup;
    public TrashService(AppDbContext db, LogService log, BackupService backup) { _db = db; _log = log; _backup = backup; }

    /// <summary>
    /// 构造一条回收站记录（不入库）。调用方可把它与业务行的删除放进同一次
    /// SaveChangesAsync，避免「回收站写成功、业务行没删掉」这类中间态。
    /// </summary>
    public static TrashItem NewItem(string table, int originalId, string title, object data, int userId, string userName)
        => new()
        {
            OriginalTable = table, OriginalId = originalId, Title = title,
            DataJson = JsonSerializer.Serialize(data),
            DeletedByUserId = userId, DeletedByName = userName
        };

    public async Task<TrashItem> MoveToTrash(string table, int originalId, string title, object data, int userId, string userName)
    {
        var item = NewItem(table, originalId, title, data, userId, userName);
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
                case "backup":
                    var bf = JsonSerializer.Deserialize<Dictionary<string, string>>(item.DataJson);
                    if (bf is null || !bf.TryGetValue("fileName", out var fn) || !_backup.RestoreBackupFromTrash(fn)) return false;
                    break;
                case "InventoryItem":
                    var inv = JsonSerializer.Deserialize<InventoryItem>(item.DataJson);
                    if (inv is null)
                    {
                        _log.Error("trash", $"Restore failed: {item.Title}", "DataJson 反序列化为 null，已保留回收站记录不删除");
                        return false;   // 反序列化失败时绝不能删掉回收站行，否则数据不可恢复
                    }
                    inv.Id = 0; _db.InventoryItems.Add(inv);
                    break;
                case "BatteryRecord":
                    var bat = JsonSerializer.Deserialize<BatteryRecord>(item.DataJson);
                    if (bat is null)
                    {
                        _log.Error("trash", $"Restore failed: {item.Title}", "DataJson 反序列化为 null，已保留回收站记录不删除");
                        return false;
                    }
                    bat.Id = 0; _db.BatteryRecords.Add(bat);
                    break;
                case "IncidentRecord":
                    var inc = JsonSerializer.Deserialize<IncidentRecord>(item.DataJson);
                    if (inc is null)
                    {
                        _log.Error("trash", $"Restore failed: {item.Title}", "DataJson 反序列化为 null，已保留回收站记录不删除");
                        return false;
                    }
                    inc.Id = 0; _db.IncidentRecords.Add(inc);
                    break;
                case "PurchaseRequest":
                    var pur = JsonSerializer.Deserialize<PurchaseRequest>(item.DataJson);
                    if (pur is null)
                    {
                        _log.Error("trash", $"Restore failed: {item.Title}", "DataJson 反序列化为 null，已保留回收站记录不删除");
                        return false;
                    }
                    // 导航属性置空：DataJson 若带出了关联 User，EF 会把它们当新实体一起插入。
                    // 外键标量(RequesterUserId/ApproverUserId)已随 JSON 保留，信息不丢。
                    pur.Id = 0; pur.Requester = null; pur.Approver = null;
                    _db.PurchaseRequests.Add(pur);
                    break;
                default:
                    return false;
            }
            _db.TrashItems.Remove(item);
            await _db.SaveChangesAsync();
            _log.Info("trash", $"Restored: {item.Title}");
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("trash", $"Restore failed: {item.Title}", ex.Message);
            return false;
        }
    }

    public async Task<bool> DeleteForever(long id)
    {
        var item = await _db.TrashItems.FindAsync(id);
        if (item is null) return false;
        if (item.OriginalTable == "backup")
        {
            var bf = JsonSerializer.Deserialize<Dictionary<string, string>>(item.DataJson);
            if (bf is not null && bf.TryGetValue("fileName", out var fn))
                _backup.DeleteBackupForever(fn);
        }
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
