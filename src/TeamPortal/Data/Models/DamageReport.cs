namespace TeamPortal.Data.Models;

public class DamageReport
{
    public int Id { get; set; }
    public int InventoryItemId { get; set; }
    public InventoryItem? Item { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string Type { get; set; } = "damage"; // damage | loss
    public string Description { get; set; } = string.Empty;
    public bool IsApprovedTest { get; set; }
    public string Liability { get; set; } = "pending"; // exempt | compensate | pending
    public decimal? CompensationAmount { get; set; }
    public string? Resolution { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
