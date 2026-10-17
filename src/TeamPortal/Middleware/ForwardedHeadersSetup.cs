using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace TeamPortal.Middleware;

/// <summary>
/// 可信反向代理解析（ForwardedHeaders）。
///
/// 为什么需要：部署在 docker / nginx 之后时，后端看到的对端是代理容器的 IP
/// （实测线上全部审计记录都是同一个 10.255.1.x），真实客户端 IP 只在 X-Forwarded-For 里。
/// 但绝不能无条件相信这个头——任何人都能伪造它，从而在审计里冒充别人、并绕开基于 IP 的登录限流，
/// 所以只有「直连对端落在显式配置的可信代理列表内」时才处理。
///
/// ⚠️ **配置口径（审计 #22）**：`KnownProxies` 只填**真正的代理容器地址**
/// （本仓库用 compose 固定子网 + 静态 IP 让它确定），**不要**填 172.16.0.0/12 / 10.0.0.0/8
/// 这类「所有私网」——那等于允许任意私网来源伪造来源 IP。
///
/// `ForwardLimit`（默认 **1**）＝「从右端只信任 1 条代理记录」：.NET 的实现从 XFF 链的**右端**
/// 开始处理，最右那条正是可信代理自己追加的（nginx `$remote_addr`、或 Next 直连对端），
/// 因此客户端在左边塞多少伪造值都不会改变结果。只有「多层代理逐跳追加」才需要调大。
///
/// 解析逻辑抽成纯函数便于单测：配置串写错会静默退化成「记录代理 IP」，很难发现。
/// </summary>
public static class ForwardedHeadersSetup
{
    /// <summary>未配置任何可信代理时返回 null（调用方不应注册中间件）。</summary>
    public static ForwardedHeadersOptions? Create(string? knownNetworks, string? knownProxies, int forwardLimit = 1)
    {
        var networks = ParseNetworks(knownNetworks).ToList();
        var proxies = ParseProxies(knownProxies).ToList();
        if (networks.Count == 0 && proxies.Count == 0) return null;

        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            // 显式写死，不依赖框架默认值：只信任紧邻本服务的那一跳代理
            ForwardLimit = forwardLimit < 1 ? 1 : forwardLimit
        };
        foreach (var network in networks) options.KnownIPNetworks.Add(network);
        foreach (var proxy in proxies) options.KnownProxies.Add(proxy);
        return options;
    }

    /// <summary>解析分号分隔的 CIDR 或单 IP；非法项忽略（不抛异常，避免一个笔误让服务起不来）。</summary>
    internal static IEnumerable<System.Net.IPNetwork> ParseNetworks(string? config)
    {
        foreach (var entry in Split(config))
        {
            var parts = entry.Split('/');
            if (parts.Length == 2)
            {
                if (IPAddress.TryParse(parts[0], out var ip) && int.TryParse(parts[1], out var prefix)
                    && prefix >= 0 && prefix <= (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? 128 : 32))
                    yield return new System.Net.IPNetwork(ip, prefix);
                continue;
            }
            if (IPAddress.TryParse(entry, out var single))
                yield return new System.Net.IPNetwork(single, single.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? 128 : 32);
        }
    }

    internal static IEnumerable<IPAddress> ParseProxies(string? config)
    {
        foreach (var entry in Split(config))
            if (IPAddress.TryParse(entry, out var ip)) yield return ip;
    }

    private static IEnumerable<string> Split(string? config) =>
        (config ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
