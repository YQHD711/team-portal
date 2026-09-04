namespace TeamPortal.Data.Models;

public class PilotProfile
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string Level { get; set; } = "学员";
    public double TotalFlightHours { get; set; }
    public DateTime? FirstFlightDate { get; set; }
    public string? Bio { get; set; }
    public string? EmergencyContact { get; set; }
    public string? EmergencyPhone { get; set; }
    public string? FlightTypes { get; set; }
    public string? Skills { get; set; } // 技能标签,逗号分隔,如 "STM32,焊接,PCB设计"
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
