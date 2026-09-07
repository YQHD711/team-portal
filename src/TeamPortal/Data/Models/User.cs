using System.Text.Json.Serialization;

namespace TeamPortal.Data.Models;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    [JsonIgnore]
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "member";
    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public int? InvitedByUserId { get; set; }
    public User? InvitedByUser { get; set; }
    /// <summary>微信网页授权 openid（每个公众号应用独立，登录绑定主键，唯一索引）</summary>
    public string? WeChatOpenId { get; set; }
    /// <summary>微信开放平台 unionid（同一开放平台账号下跨应用一致，可空）</summary>
    public string? WeChatUnionId { get; set; }
    public DateTime? WeChatBoundAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
