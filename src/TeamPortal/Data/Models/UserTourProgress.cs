namespace TeamPortal.Data.Models;

/// <summary>
/// 每条引导在每个人身上的进度。
///
/// 刻意做成服务端持久化（不只用 localStorage）：换设备不丢、清缓存不归零，
/// 并且管理员能看到完成率——与 StudyProgress 同一思路。
/// (UserId, TourKey) 唯一，前端本地缓存只作加速。
/// </summary>
public class UserTourProgress
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }

    /// <summary>引导 key（对应前端 TourDef.key）</summary>
    public string TourKey { get; set; } = string.Empty;

    /// <summary>in_progress | done | skipped</summary>
    public string Status { get; set; } = "in_progress";

    /// <summary>进行到第几步（从 0 开始；done/skipped 时保留最后位置，便于重看时定位）</summary>
    public int StepIndex { get; set; }

    /// <summary>完成/跳过时对应的内容版本，用于判断"引导已更新"</summary>
    public int Version { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
