namespace TeamPortal.Data.Models;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "member";
    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
