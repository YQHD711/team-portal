using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// 建议问题里的 `kind=inventory`（task-14 A）：**真实房间**与**真实物料**。
///
/// 守门（避免把占位数据当建议推给用户）：
///   - 物料题：库存里物料数 **&lt; <see cref="MinItemsForItemQuestion"/> 件**时不出（线上全库只有 1 件 "测试1"）；
///   - 房间题：只要有布局数据就出一题，优先"库房"（物料相关），否则取房间号最小的那个；
///   - 一条都不存在（数据库为空）时返回空表，不影响 doc/study 题。
///
/// 房间题与物料题的**答案**由 LiveInventoryContext 在每次提问时现查数据库给出（不写进索引）。
/// </summary>
public partial class AiSuggestionService
{
    /// <summary>物料数少于这个值时不生成物料题（线上只有 1 件占位数据）。</summary>
    public const int MinItemsForItemQuestion = 3;

    private async Task<List<Suggestion>> InventorySuggestionsAsync(CancellationToken ct)
    {
        var result = new List<Suggestion>();

        var rooms = await _db.StorageLayouts.AsNoTracking().OrderBy(l => l.RoomCode).ToListAsync(ct);
        var room = rooms.FirstOrDefault(r => r.RoomName.Contains("库房")) ?? rooms.FirstOrDefault();
        if (room is not null) result.Add(new Suggestion($"「{room.RoomCode} {room.RoomName}」的货架分布？", "inventory"));

        var items = await _db.InventoryItems.AsNoTracking().ToListAsync(ct);
        if (items.Count >= MinItemsForItemQuestion)
        {
            // 优先有库存的、再按编码排序，保证同一个库出题稳定
            var item = items.Where(i => i.Quantity > 0).OrderBy(i => i.Code, StringComparer.Ordinal).FirstOrDefault()
                       ?? items.OrderBy(i => i.Code, StringComparer.Ordinal).First();
            result.Add(new Suggestion($"「{item.Name}」还剩多少？", "inventory"));
        }

        return result;
    }
}
