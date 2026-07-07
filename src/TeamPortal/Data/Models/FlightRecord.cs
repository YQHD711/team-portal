namespace TeamPortal.Data.Models;

public class FlightRecord
{
    public int Id { get; set; }
    public int PilotUserId { get; set; }
    public User? Pilot { get; set; }
    public string AircraftModel { get; set; } = string.Empty;
    public DateTime TakeoffTime { get; set; } = DateTime.UtcNow;
    public DateTime? LandingTime { get; set; }
    public double? DurationMinutes { get; set; }
    public string? Location { get; set; }
    public string? Weather { get; set; }
    public string? Notes { get; set; }
    public string? LogFileName { get; set; }
    public string? BatteryNumber { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
