using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 设备接入认证。
///
/// 为什么不用 BCrypt：设备 Secret 是服务端生成的 192 位随机值，本身没有低熵问题，
/// 慢哈希只会让每个上报请求多花几十毫秒；这里用"每设备随机盐 + SHA-256"，
/// 验证时做定长比较即可（防时序侧信道）。
/// </summary>
public class DeviceAuthService
{
    public const string KeyHeader = "X-Device-Key";
    public const string SecretHeader = "X-Device-Secret";
    /// <summary>设备内用户会话 token 的请求头（登录后在设备上借还时携带）。</summary>
    public const string SessionHeader = "X-Device-Session";

    /// <summary>LastSeen 写入节流：设备高频上报时不必每请求都写库。</summary>
    private static readonly TimeSpan LastSeenThrottle = TimeSpan.FromSeconds(60);

    private readonly AppDbContext _db;
    private readonly LogService _log;

    public DeviceAuthService(AppDbContext db, LogService log)
    {
        _db = db;
        _log = log;
    }

    public static string NewDeviceKey()
        => "dev_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();

    public static string NewSecret()
        => Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    public static string HashSecret(string secret)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = SHA256.HashData(Concat(salt, Encoding.UTF8.GetBytes(secret)));
        return $"{Convert.ToHexString(salt)}:{Convert.ToHexString(hash)}";
    }

    public static bool VerifySecret(string secret, string stored)
    {
        var parts = stored.Split(':');
        if (parts.Length != 2) return false;
        try
        {
            var salt = Convert.FromHexString(parts[0]);
            var expected = Convert.FromHexString(parts[1]);
            var actual = SHA256.HashData(Concat(salt, Encoding.UTF8.GetBytes(secret)));
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static byte[] Concat(byte[] a, byte[] b)
    {
        var r = new byte[a.Length + b.Length];
        Buffer.BlockCopy(a, 0, r, 0, a.Length);
        Buffer.BlockCopy(b, 0, r, a.Length, b.Length);
        return r;
    }

    public async Task<(Device Device, string Secret)> CreateAsync(string name, string type, string? locationCode)
    {
        var secret = NewSecret();
        var device = new Device
        {
            Name = name,
            DeviceKey = NewDeviceKey(),
            SecretHash = HashSecret(secret),
            Type = string.IsNullOrWhiteSpace(type) ? "esp32" : type,
            LocationCode = string.IsNullOrWhiteSpace(locationCode) ? null : locationCode.Trim(),
        };
        _db.Devices.Add(device);
        await _db.SaveChangesAsync();
        _log.Info("device", $"Device created: {device.Name} ({device.DeviceKey})");
        return (device, secret);
    }

    /// <summary>从请求头认证设备；未带凭据、密钥错误、已禁用一律返回 null。</summary>
    public async Task<Device?> AuthenticateAsync(HttpContext ctx)
    {
        var key = ctx.Request.Headers[KeyHeader].ToString();
        var secret = ctx.Request.Headers[SecretHeader].ToString();
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(secret)) return null;

        var device = await _db.Devices.FirstOrDefaultAsync(d => d.DeviceKey == key);
        if (device is null) return null;
        if (!device.Enabled) return null;
        if (!VerifySecret(secret, device.SecretHash)) return null;

        var now = DateTime.UtcNow;
        if (device.LastSeenAt is null || now - device.LastSeenAt.Value >= LastSeenThrottle)
        {
            device.LastSeenAt = now;
            device.LastSeenIp = LogService.ClientIp(ctx);
            await _db.SaveChangesAsync();
        }

        return device;
    }

    // ── 设备内用户会话（设备登录 → 借还，不复用用户 JWT）──

    /// <summary>会话默认有效期：12 小时（设备放在柜子旁，一天一班足够）。</summary>
    public static readonly TimeSpan SessionTtl = TimeSpan.FromHours(12);

    public static string HashToken(string token)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>为设备上的用户创建会话；返回明文 token（只此一次）。</summary>
    public async Task<(DeviceSession Session, string Token)> CreateSessionAsync(Device device, User user, HttpContext ctx)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        var now = DateTime.UtcNow;
        var session = new DeviceSession
        {
            DeviceId = device.Id,
            UserId = user.Id,
            TokenHash = HashToken(token),
            CreatedAt = now,
            ExpiresAt = now.Add(SessionTtl),
            CreatedIp = LogService.ClientIp(ctx),
        };
        _db.DeviceSessions.Add(session);
        await _db.SaveChangesAsync();
        _log.Info("device", $"Device user session created: {device.DeviceKey} -> {user.Username}");
        return (session, token);
    }

    /// <summary>校验设备内用户会话：必须属于当前设备、未撤销、未过期。</summary>
    public async Task<DeviceSession?> AuthenticateSessionAsync(HttpContext ctx, Device device)
    {
        var token = ctx.Request.Headers[SessionHeader].ToString();
        if (string.IsNullOrWhiteSpace(token)) return null;

        var hash = HashToken(token);
        var session = await _db.DeviceSessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.DeviceId == device.Id && s.TokenHash == hash);
        if (session is null) return null;
        if (session.RevokedAt is not null) return null;
        if (session.ExpiresAt <= DateTime.UtcNow) return null;
        return session;
    }

    /// <summary>登出设备内用户（撤销会话）；返回是否找到并撤销。</summary>
    public async Task<bool> RevokeSessionAsync(HttpContext ctx, Device device)
    {
        var token = ctx.Request.Headers[SessionHeader].ToString();
        if (string.IsNullOrWhiteSpace(token)) return false;

        var hash = HashToken(token);
        var session = await _db.DeviceSessions
            .FirstOrDefaultAsync(s => s.DeviceId == device.Id && s.TokenHash == hash);
        if (session is null || session.RevokedAt is not null) return false;

        session.RevokedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _log.Info("device", $"Device user session revoked: {device.DeviceKey}");
        return true;
    }

    public async Task<string?> RotateSecretAsync(int deviceId)
    {
        var device = await _db.Devices.FindAsync(deviceId);
        if (device is null) return null;
        var secret = NewSecret();
        device.SecretHash = HashSecret(secret);
        await _db.SaveChangesAsync();
        _log.Info("device", $"Device secret rotated: {device.Name} ({device.DeviceKey})");
        return secret;
    }
}
