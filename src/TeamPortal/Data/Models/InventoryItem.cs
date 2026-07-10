namespace TeamPortal.Data.Models;

public class InventoryItem
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string? LocationCode { get; set; }
    public string Status { get; set; } = "available";
    public string Grade { get; set; } = "C";
    public decimal UnitPrice { get; set; }
    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public string? ProjectTag { get; set; }
    public string? PhotoUrl { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
