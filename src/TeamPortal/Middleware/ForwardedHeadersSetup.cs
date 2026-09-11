using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace TeamPortal.Middleware;

/// <summary>
/// 可信反向代理解析（ForwardedHeaders）。
///
/// 为什么需要：部署在 nginx / docker 之后时，后端看到的对端是代理容器的 IP
/// （实测线上全部审计记录都是同一个 10.255.1.x），真实客户端 IP 只在 X-Forwarded-For 里。
/// 但绝不能无条件相信这个头——任何人都能伪造它来绕过基于 IP 的登录限流，
/// 所以只有「对端落在显式配置的可信网段内」时才处理。
///
/// 解析逻辑抽成纯函数便于单测：配置串写错会静默退化成「记录代理 IP」，很难发现。
/// </summary>
public static class ForwardedHeadersSetup
{
    /// <summary>未配置任何可信代理时返回 null（调用方不应注册中间件）。</summary>
    public static ForwardedHeadersOptions? Create(string? knownNetworks, string? knownProxies)
    {
        var networks = ParseNetworks(knownNetworks).ToList();
        var proxies = ParseProxies(knownProxies).ToList();
        if (networks.Count == 0 && proxies.Count == 0) return null;

        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
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
