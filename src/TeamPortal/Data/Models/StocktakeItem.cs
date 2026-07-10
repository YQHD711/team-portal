namespace TeamPortal.Data.Models;

public class StocktakeItem
{
    public int Id { get; set; }
    public int StocktakeId { get; set; }
    public Stocktake? Stocktake { get; set; }
    public int InventoryItemId { get; set; }
    public InventoryItem? InventoryItem { get; set; }
    public int SystemQty { get; set; }
    public int? ActualQty { get; set; }
    public int? Difference { get; set; }
    public string? Note { get; set; }
    public int? CheckedByUserId { get; set; }
    public User? CheckedBy { get; set; }
}
