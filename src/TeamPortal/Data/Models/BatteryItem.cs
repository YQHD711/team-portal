namespace TeamPortal.Data.Models;

/// <summary>
/// 电池单件台账：每块电池一条记录，Code 是贴在电池上的唯一码。
///
/// 与数量型 InventoryItem 分开：电池要追责到"具体哪一块"，借还也远比物料领用高频，
/// 塞进物料库存模型会让审批链和数量语义纠缠不清。
/// </summary>
public class BatteryItem
{
    public int Id { get; set; }

    /// <summary>唯一码（如 BAT-0001），贴在电池上；库内唯一，大小写不敏感查询。</summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>型号（如 6S 3300mAh），可为空。</summary>
    public string? Model { get; set; }

    /// <summary>in_stock / borrowed / charging / repair / retired</summary>
    public string Status { get; set; } = "in_stock";

    /// <summary>健康度（正常/鼓包/待检等），沿用电池事故记录的口径。</summary>
    public string? Health { get; set; } = "正常";

    /// <summary>当前借用人；在库时为 null。</summary>
    public int? CurrentBorrowerId { get; set; }
    public User? CurrentBorrower { get; set; }

    /// <summary>当前这次借出的时间；在库时为 null。</summary>
    public DateTime? BorrowedAt { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
