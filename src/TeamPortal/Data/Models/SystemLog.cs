namespace TeamPortal.Data.Models;

public class SystemLog
{
    public long Id { get; set; }
    public string Level { get; set; } = "info"; // info, warn, error
    public string Category { get; set; } = "system"; // auth, wiki, knowledge, inventory, admin
    public string Message { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public string? UserName { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
