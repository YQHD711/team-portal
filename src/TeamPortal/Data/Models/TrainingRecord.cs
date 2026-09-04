namespace TeamPortal.Data.Models;

public class TrainingRecord
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string CourseName { get; set; } = string.Empty;
    public double? Score { get; set; }
    public DateTime ExamDate { get; set; } = DateTime.UtcNow;
    public string? Examiner { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
