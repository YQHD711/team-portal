namespace TeamPortal.Data.Models;

public class BatteryRecord
{
    public int Id { get; set; }
    public string BatteryNumber { get; set; } = string.Empty;
    public string? Health { get; set; } = "正常";
    public DateTime IncidentDate { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
