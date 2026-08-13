namespace TeamPortal.Data.Models;

public class DepartmentExam
{
    public int Id { get; set; }
    public int DepartmentId { get; set; }
    public Department? Department { get; set; }
    public string Title { get; set; } = "";      // 考核任务名,如 "2026秋季理论考核" / "焊接实操"
    public string ExamType { get; set; } = "theory"; // theory=理论 / practice=实操
    public string Status { get; set; } = "ongoing";  // ongoing=进行中 / completed=已完成
    public DateTime? ExamDate { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class DepartmentExamResult
{
    public int Id { get; set; }
    public int ExamId { get; set; }
    public DepartmentExam? Exam { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public bool Passed { get; set; }
    public double? Score { get; set; }          // 分数(可选)
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
