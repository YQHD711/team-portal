namespace TeamPortal.Data.Models;

public class IncidentRecord
{
    public int Id { get; set; }
    public string Type { get; set; } = "设备故障";
    public string Severity { get; set; } = "一般";
    public string Description { get; set; } = string.Empty;
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public string? Resolution { get; set; }
    public string? ReportedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    // 可见性控制:记录提交人 + 提交人所属部门(部长只能看本部门成员的提交)
    public int? ReporterUserId { get; set; }
    public int? DepartmentId { get; set; }
}
