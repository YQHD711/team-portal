namespace TeamPortal.Data.Models;

public class IncidentRecord
{
    public int Id { get; set; }
    public string Type { get; set; } = "设备故障";
    public string Severity { get; set; } = "一般";
    public string Description { get; set; } = string.Empty;
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public int? RelatedFlightId { get; set; }
    public FlightRecord? RelatedFlight { get; set; }
    public string? Resolution { get; set; }
    public string? ReportedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
