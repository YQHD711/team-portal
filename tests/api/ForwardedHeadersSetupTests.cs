using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using TeamPortal.Middleware;

namespace api;

/// <summary>
/// 可信反向代理解析。回归背景：线上审计里所有来源 IP 都是同一个代理容器 IP ——
/// 因为对端不在可信网段内时 X-Forwarded-For 会被整条忽略。
/// 配置串写错会静默退化成「记录代理 IP」，所以解析必须有测试。
/// </summary>
public class ForwardedHeadersSetupTests
{
    [Fact]
    public void Create_WithNetworksAndProxies_BuildsOptions()
    {
        var options = ForwardedHeadersSetup.Create("172.16.0.0/12;10.0.0.0/8", "127.0.0.1");

        Assert.NotNull(options);
        Assert.Contains(options!.KnownIPNetworks, n => n.PrefixLength == 12);
        Assert.Contains(options.KnownIPNetworks, n => n.PrefixLength == 8);
        Assert.Contains(IPAddress.Loopback, options.KnownProxies);
        Assert.True(options.ForwardedHeaders.HasFlag(ForwardedHeaders.XForwardedFor));
        Assert.True(options.ForwardedHeaders.HasFlag(ForwardedHeaders.XForwardedProto));
    }

    [Fact]
    public void Create_KeepsFrameworkLoopbackDefaults()
    {
        var options = ForwardedHeadersSetup.Create("10.0.0.0/8", null)!;

        // 框架自带的回环信任（127.0.0.0/8 + ::1）我们刻意不清理：本机调试/健康检查要靠它
        Assert.Contains(options.KnownIPNetworks,
            n => n.PrefixLength == 8 && n.BaseAddress.Equals(IPAddress.Parse("127.0.0.0")));
        Assert.Contains(IPAddress.IPv6Loopback, options.KnownProxies);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" ; ; ")]
    public void Create_WithoutTrustedProxies_ReturnsNull(string? config)
        => Assert.Null(ForwardedHeadersSetup.Create(config, config));

    [Fact]
    public void ParseNetworks_SingleIp_BecomesHostNetwork()
    {
        var networks = ForwardedHeadersSetup.ParseNetworks("10.255.1.5").ToList();

        var network = Assert.Single(networks);
        Assert.Equal(32, network.PrefixLength);
        Assert.Equal(IPAddress.Parse("10.255.1.5"), network.BaseAddress);
    }

    [Fact]
    public void ParseNetworks_Ipv6Single_Becomes128()
    {
        var networks = ForwardedHeadersSetup.ParseNetworks("::1").ToList();

        Assert.Equal(128, Assert.Single(networks).PrefixLength);
    }

    [Fact]
    public void ParseNetworks_TolerSloppySeparatorsAndSpaces()
    {
        var networks = ForwardedHeadersSetup.ParseNetworks(" 172.16.0.0/12 ;; 10.0.0.0/8 ;127.0.0.1 ").ToList();

        Assert.Equal(3, networks.Count);
        Assert.Equal([12, 8, 32], networks.Select(n => n.PrefixLength));
    }

    [Theory]
    [InlineData("not-an-ip")]
    [InlineData("10.0.0.0/xx")]
    [InlineData("10.0.0.0/33")]   // IPv4 前缀越界
    [InlineData("10.0.0.0/-1")]
    public void ParseNetworks_InvalidEntries_AreIgnoredNotThrown(string config)
        => Assert.Empty(ForwardedHeadersSetup.ParseNetworks(config));

    [Fact]
    public void ParseNetworks_KeepsValidEntriesAlongsideInvalidOnes()
    {
        var networks = ForwardedHeadersSetup.ParseNetworks("garbage;172.16.0.0/12;10.0.0.0/33").ToList();

        Assert.Equal(12, Assert.Single(networks).PrefixLength);
    }

    [Fact]
    public void ParseProxies_IgnoresCidrAndGarbage()
    {
        var proxies = ForwardedHeadersSetup.ParseProxies("127.0.0.1;172.16.0.0/12;nope;::1").ToList();

        Assert.Equal(2, proxies.Count);
        Assert.Contains(IPAddress.Loopback, proxies);
        Assert.Contains(IPAddress.IPv6Loopback, proxies);
    }

    [Fact]
    public void Create_NetworksOnly_IsEnough()
    {
        var options = ForwardedHeadersSetup.Create("10.0.0.0/8", null);

        Assert.NotNull(options);
        Assert.Contains(options!.KnownIPNetworks, n => n.PrefixLength == 8 && n.BaseAddress.Equals(IPAddress.Parse("10.0.0.0")));
    }
}
