namespace TeamPortal.Data.Models;

public class SkillCertification
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string CertName { get; set; } = "";      // 认证项目名,如 "STM32开发" / "焊接" / "视频剪辑"
    public string Level { get; set; } = "";          // 认证等级,如 "初级/中级/高级" 或自定义
    public string Status { get; set; } = "pending";  // pending=待认证 / passed=已通过 / failed=未通过
    public DateTime? CertDate { get; set; }          // 认证日期
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
