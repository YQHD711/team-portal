namespace TeamPortal.Data.Models;

/// <summary>
/// 学习库课时完成记录。
///
/// 刻意做成**服务端**持久化（而不是 localStorage）：换设备不丢、清缓存不归零、
/// 不能自己改，因此可以拿来做部门完成率与后续的培训考核依据。
/// (UserId, Path) 唯一 —— 一个用户对一个课时只有一条记录。
/// </summary>
public class StudyProgress
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }

    /// <summary>知识库相对路径，例如 公共/学习库/01-入门筑基/01-认识航模.md</summary>
    public string Path { get; set; } = string.Empty;

    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
}
