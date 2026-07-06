namespace TeamPortal.Data.Models;

public class InventoryItem
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string Location { get; set; } = string.Empty;
    public string Status { get; set; } = "available";
    public string? PhotoUrl { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
