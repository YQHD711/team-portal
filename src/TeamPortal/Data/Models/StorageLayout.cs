using System.ComponentModel.DataAnnotations;

namespace TeamPortal.Data.Models;

/// <summary>房间库位布局：房间-货架-层-位的网格配置</summary>
public class StorageLayout
{
    public int Id { get; set; }
    public string RoomCode { get; set; } = string.Empty;
    public string RoomName { get; set; } = string.Empty;
    public int Floor { get; set; }
    public int CabinetCount { get; set; }
    public int ShelfCount { get; set; }
    public int PositionCount { get; set; }
    public string? Description { get; set; }
    /// <summary>平面图 JSON（墙/门/窗/元素），由前端编辑器读写，后端只做存取；空则回退旧网格模式</summary>
    public string? LayoutJson { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// 乐观并发版本：每次成功保存 +1。客户端保存时必须回传"我加载时的版本"，
    /// 不一致就 409（防止后保存的人静默覆盖先保存的人 —— 实测确实会丢数据）。
    /// **不要用 UpdatedAt 当版本**：它只到秒，同一秒内的两次保存无法区分（实测撞过）。
    ///
    /// `[ConcurrencyCheck]` 让 EF 在 UPDATE 时带上 `WHERE Version = 原值`：
    /// 真正并发的两个请求里只有一个能更新成功，另一个抛 DbUpdateConcurrencyException → 409，
    /// 否则"两个都读到同版本、两个都写成功"的丢更新就会漏过去。
    /// </summary>
    [ConcurrencyCheck]
    public int Version { get; set; } = 1;

    /// <summary>最后一次保存者（409 时告诉对方"谁改的"，可读性用）</summary>
    public string? UpdatedBy { get; set; }
}
