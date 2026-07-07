namespace TeamPortal.Data.Models;

public class TrashItem
{
    public long Id { get; set; }
    public string OriginalTable { get; set; } = string.Empty;
    public int OriginalId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string DataJson { get; set; } = "{}";
    public int DeletedByUserId { get; set; }
    public string DeletedByName { get; set; } = string.Empty;
    public DateTime DeletedAt { get; set; } = DateTime.UtcNow;
}
