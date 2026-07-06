namespace TeamPortal.Data.Models;

public class InventoryTransaction
{
    public int Id { get; set; }
    public int InventoryItemId { get; set; }
    public string Type { get; set; } = string.Empty; // "checkout" or "checkin"
    public int Quantity { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public InventoryItem? Item { get; set; }
}
