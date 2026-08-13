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
}
