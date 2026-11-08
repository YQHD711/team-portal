namespace TeamPortal.Data.Models;

/// <summary>
/// 电池借还流水：借出时创建，归还时补 ReturnedAt。
/// 未归还（ReturnedAt == null）的那条就是"当前在借"，与 BatteryItem.Status 互相印证。
/// </summary>
public class BatteryLoan
{
    public int Id { get; set; }

    public int BatteryId { get; set; }
    public BatteryItem? Battery { get; set; }

    /// <summary>借用人。</summary>
    public int UserId { get; set; }
    public User? User { get; set; }

    public DateTime BorrowedAt { get; set; } = DateTime.UtcNow;

    /// <summary>归还时间；null = 尚未归还。</summary>
    public DateTime? ReturnedAt { get; set; }

    /// <summary>归还操作人（支持管理员代还）；null 表示本人归还。</summary>
    public int? ReturnedByUserId { get; set; }
    public User? ReturnedBy { get; set; }

    public string? Note { get; set; }
}
