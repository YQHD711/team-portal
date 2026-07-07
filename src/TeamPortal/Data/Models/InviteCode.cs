namespace TeamPortal.Data.Models;

public class InviteCode
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public int MaxUses { get; set; } = 1;
    public int UsedCount { get; set; }
    public int CreatedByUserId { get; set; }
    public bool IsRevoked { get; set; }
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddDays(7);
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
