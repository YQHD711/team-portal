namespace TeamPortal.Data.Models;

public class Stocktake
{
    public int Id { get; set; }
    public string Type { get; set; } = "weekly"; // weekly | semester
    public string Grade { get; set; } = "A"; // A | B | C
    public string Status { get; set; } = "in_progress"; // in_progress | completed
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public int CreatedByUserId { get; set; }
    public User? CreatedBy { get; set; }

    public List<StocktakeItem> Items { get; set; } = new();
}
