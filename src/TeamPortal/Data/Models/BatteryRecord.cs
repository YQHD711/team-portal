namespace TeamPortal.Data.Models;

public class BatteryRecord
{
    public int Id { get; set; }
    public string BatteryNumber { get; set; } = string.Empty;
    public int CycleCount { get; set; }
    public double? CapacityMAh { get; set; }
    public string? Health { get; set; } = "正常";
    public DateTime? LastUsedDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
