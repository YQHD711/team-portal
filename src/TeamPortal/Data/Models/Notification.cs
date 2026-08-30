namespace TeamPortal.Data.Models;

/// <summary>
/// 通知实体。Level 控制 UI 渲染(icon/color/toast),TargetRole 控制可见性,
/// PayloadJson 提供给客户端的扩展数据(跳转 URL、操作类型等)。
/// TitleTemplate/MessageTemplate 是带 {var} 占位的模板,前端按角色渲染时替换。
/// </summary>
public class Notification
{
    public long Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? Link { get; set; }
    public bool IsRead { get; set; }
    public int? UserId { get; set; }
    /// <summary>null = 全员可见;"staff" = admin+部长;"admin" = 仅 admin</summary>
    public string? TargetRole { get; set; }
    /// <summary>info | success | warning | critical,默认 info</summary>
    public string Level { get; set; } = "info";
    /// <summary>JSON 扩展数据:跳转路由参数、操作类型、数量等。客户端使用</summary>
    public string? PayloadJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
