using System.Text.Json.Serialization;

namespace TeamPortal.Data.Models;

/// <summary>
/// 设备内用户会话：设备先用 X-Device-Key/X-Device-Secret 认证，再在设备上登录某个用户，
/// 换一个短期 sessionToken。设备借还时同时带「设备凭据 + 会话凭据」，不复用用户 JWT。
///
/// 为什么单独一张表：会话可撤销、可过期、可按设备审计；用随机 token + 哈希存储，
/// 不引入第二种 JWT，避免和用户 JWT 的校验链纠缠。
/// </summary>
public class DeviceSession
{
    public int Id { get; set; }

    public int DeviceId { get; set; }
    public Device? Device { get; set; }

    public int UserId { get; set; }
    public User? User { get; set; }

    /// <summary>sessionToken 的 SHA-256（十六进制）；明文只在登录响应里出现一次。</summary>
    [JsonIgnore]
    public string TokenHash { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime ExpiresAt { get; set; }

    public DateTime? RevokedAt { get; set; }

    public string? CreatedIp { get; set; }
}
