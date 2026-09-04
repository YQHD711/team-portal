namespace TeamPortal.Data.Models;

/// <summary>
/// AI-generated code improvement proposal. Requires admin approval before applying.
/// </summary>
public class CodeProposal
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public string? OriginalCode { get; set; }
    public string? SuggestedCode { get; set; }
    public string Status { get; set; } = "pending"; // pending | approved | rejected | applied | failed | reverted
    public string? ErrorMessage { get; set; }
    public string? CreatedBy { get; set; }
    public string? ReviewedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
