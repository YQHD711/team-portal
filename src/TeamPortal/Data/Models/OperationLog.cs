namespace TeamPortal.Data.Models;

/// <summary>
/// 业务操作审计日志(与 SystemLog 请求/运行日志分离存储)
/// </summary>
public class OperationLog
{
    public long Id { get; set; }
    public int? UserId { get; set; }
    public string UserName { get; set; } = string.Empty; // 操作人
    public string Action { get; set; } = string.Empty;   // 操作类型: login/logout/checkout/checkin/damage-report/stocktake/backup/restore/import/create/update/delete/settings 等
    public string? TargetType { get; set; }              // 目标类型: material/item/user/log/backup/settings 等
    public string? TargetId { get; set; }                // 目标标识(ID 或名称)
    public string? Data { get; set; }                    // 操作数据 JSON(关键字段)
    public string? IpAddress { get; set; }               // 来源 IP
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
