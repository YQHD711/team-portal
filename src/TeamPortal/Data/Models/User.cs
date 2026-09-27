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
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// 已签发 token 的版本号。改角色 / 改部门 / 改密码时自增，
    /// JWT 校验时与 token 里的声明比对，不一致即作废。
    ///
    /// 为什么需要它：JWT 默认活 7 天且声明不可撤销 ——
    /// 被免职的部长、被换部门的人、被改密码的账号，
    /// 旧 token 会带着旧身份继续通过**鉴权与授权策略**校验（不只是数据可见性）。
    /// </summary>
    public int TokenVersion { get; set; }
}
