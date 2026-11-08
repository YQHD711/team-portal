namespace TeamPortal.Data.Models;

/// <summary>
/// 接入本系统的物联网设备（ESP32、传感器网关等）。
///
/// 设备不走用户 JWT：设备没有密码登录流程，用 App 里创建时一次性签发的
/// DeviceKey + Secret 认证（见 Services/DeviceAuthService）。
/// Secret 只存哈希，明文只在创建/重置的那一次响应里返回。
/// </summary>
public class Device
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>设备公开标识，请求头 X-Device-Key 携带；库内唯一。</summary>
    public string DeviceKey { get; set; } = string.Empty;

    /// <summary>Secret 的加盐 SHA-256（"salt:hash" 十六进制）。不序列化给客户端。</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public string SecretHash { get; set; } = string.Empty;

    /// <summary>设备类型：esp32 / sensor / gateway / other。</summary>
    public string Type { get; set; } = "esp32";

    /// <summary>所属库位或柜体编码（可选，用于把设备与存放位置关联）。</summary>
    public string? LocationCode { get; set; }

    public string? FirmwareVersion { get; set; }

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastSeenAt { get; set; }

    public string? LastSeenIp { get; set; }
}
