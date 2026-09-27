namespace TeamPortal.Data.Models;

/// <summary>
/// 「清除」某人通知列表的标记。
///
/// 通知行是**共享**的（UserId=null 时全员或按 TargetRole 可见），直接删除会把
/// 别人的铃铛也一起清空 —— 所以清除只给当前用户打一条标记，
/// 查询时把标记过的排除掉（别人照旧看得见）。
/// </summary>
public class NotificationDismissal
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public long NotificationId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
