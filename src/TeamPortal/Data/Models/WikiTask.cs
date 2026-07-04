namespace TeamPortal.Data.Models;

public class WikiTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Type { get; set; } = "git"; // "git" | "zip"
    public string SourceUrl { get; set; } = string.Empty; // Git URL or encoded ZIP path
    public string ProjectName { get; set; } = string.Empty;
    public string TargetFolder { get; set; } = "公共"; // knowledge base folder
    public string Status { get; set; } = "pending"; // pending | preparing | catalog | documents | completed | failed
    public string? ErrorMessage { get; set; }
    public int? UserId { get; set; }
    public string? WorkspacePath { get; set; }
    public string? CatalogJson { get; set; } // generated catalog as JSON
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
