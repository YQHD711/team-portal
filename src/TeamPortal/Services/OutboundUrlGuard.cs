using System.Net;
using System.Net.Sockets;

namespace TeamPortal.Services;

/// <summary>
/// **出站 URL 守卫（防 SSRF）**。审计 #14：`git clone` 只校验了协议，主机完全不管 ——
/// 于是「部长」既能拿服务器去打内网/容器网段，也能探测云元数据地址（169.254.169.254），
/// 并通过 clone 失败的 stderr 区分 connection refused / timeout / 404，构成半盲探测 oracle。
///
/// 规则：只允许**公网**地址。
///  - 主机名字面量命中 blacklist（localhost / *.local / *.internal / 容器名）→ 拒
///  - 字面量 IP 落在私网/环回/链路本地/保留段 → 拒
///  - 域名解析后的**所有**地址都必须公网（防 DNS 指向内网）
/// </summary>
public static class OutboundUrlGuard
{
    private static readonly string[] BlockedHostSuffixes =
    {
        "localhost", ".localhost", ".local", ".internal", ".localdomain", ".home.arpa",
    };

    /// <summary>同步部分：只做字面量检查（测试/无 DNS 场景用）。</summary>
    public static void EnsureAllowedHost(Uri uri)
    {
        var host = uri.DnsSafeHost.TrimEnd('.').ToLowerInvariant();
        if (host.Length == 0) throw new InvalidOperationException("仓库地址缺少主机名");
        if (BlockedHostSuffixes.Any(s => host == s || host.EndsWith(s, StringComparison.Ordinal)))
            throw new InvalidOperationException($"不允许访问本机/内网主机名: {host}");
        if (IPAddress.TryParse(host.Trim('[', ']'), out var ip) && IsBlockedAddress(ip))
            throw new InvalidOperationException($"不允许访问内网/保留地址: {ip}");
        // 单标签主机名（如 docker compose 的服务名 `backend`、k8s `metadata`）一律拒：
        // 公网仓库域名必然带点，单标签只在内网解析。
        if (!IPAddress.TryParse(host.Trim('[', ']'), out _) && !host.Contains('.'))
            throw new InvalidOperationException($"不允许访问内网主机名: {host}");
    }

    /// <summary>完整校验：字面量 + DNS 解析结果全部必须是公网地址。</summary>
    public static async Task EnsureAllowedHostAsync(Uri uri, CancellationToken ct = default)
    {
        EnsureAllowedHost(uri);
        var host = uri.DnsSafeHost.Trim('[', ']');
        if (IPAddress.TryParse(host, out _)) return;   // 字面量 IP 已在上面判过

        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(host, ct);
        }
        catch (Exception ex) when (ex is SocketException or ArgumentException)
        {
            throw new InvalidOperationException($"仓库主机无法解析: {host}");
        }
        if (addresses.Length == 0) throw new InvalidOperationException($"仓库主机无法解析: {host}");
        foreach (var ip in addresses)
            if (IsBlockedAddress(ip))
                throw new InvalidOperationException($"不允许访问内网/保留地址: {host} → {ip}");
    }

    /// <summary>私网 / 环回 / 链路本地 / 保留段判定（IPv4 与 IPv6 都覆盖）。</summary>
    public static bool IsBlockedAddress(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return true;
        if (ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Any)) return true;
        if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal) return true;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6) return false;   // 其余公网 IPv6 放行

        var b = ip.GetAddressBytes();
        if (b[0] == 10) return true;                                  // 10.0.0.0/8
        if (b[0] == 127) return true;                                 // 127.0.0.0/8
        if (b[0] == 0) return true;                                   // 0.0.0.0/8
        if (b[0] == 169 && b[1] == 254) return true;                  // 169.254.0.0/16（含云元数据）
        if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;     // 172.16.0.0/12
        if (b[0] == 192 && b[1] == 168) return true;                  // 192.168.0.0/16
        if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return true;    // 100.64.0.0/10（CGNAT）
        if (b[0] >= 224) return true;                                 // 组播 + 保留 + 广播
        return false;
    }
}
