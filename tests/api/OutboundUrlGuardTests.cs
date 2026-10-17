using System.Net;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 审计 #14：`git clone` 出站地址守卫。
/// 原来只校验协议 → 「部长」能让服务器去连内网/容器网段与云元数据（169.254.169.254），
/// 并用 clone 失败信息区分 refused/timeout/404（半盲 SSRF 探测）。
/// </summary>
public class OutboundUrlGuardTests
{
    [Theory]
    [InlineData("http://127.0.0.1:8080/x.git")]
    [InlineData("http://localhost:3000/a.git")]
    [InlineData("http://10.1.2.3/a.git")]
    [InlineData("http://172.16.0.5/a.git")]
    [InlineData("http://192.168.1.1/a.git")]
    [InlineData("http://169.254.169.254/latest/meta-data")]
    [InlineData("http://100.64.0.1/a.git")]
    [InlineData("http://backend:8080/a.git")]           // docker compose 服务名
    [InlineData("http://foo.internal/a.git")]
    [InlineData("http://[::1]/a.git")]
    public void BlockedHosts_AreRejected(string url)
        => Assert.Throws<InvalidOperationException>(() => OutboundUrlGuard.EnsureAllowedHost(new Uri(url)));

    [Theory]
    [InlineData("https://github.com/a/b.git")]
    [InlineData("http://8.8.8.8/x.git")]
    [InlineData("https://gitee.com/a/b.git")]
    public void PublicHosts_AreAllowed(string url)
    {
        var ex = Record.Exception(() => OutboundUrlGuard.EnsureAllowedHost(new Uri(url)));
        Assert.Null(ex);
    }

    [Fact]
    public void LiteralIpv4MappedLoopback_IsBlocked()
        => Assert.True(OutboundUrlGuard.IsBlockedAddress(IPAddress.Parse("::ffff:127.0.0.1")));

    [Fact]
    public void PublicIp_IsNotBlocked()
        => Assert.False(OutboundUrlGuard.IsBlockedAddress(IPAddress.Parse("1.1.1.1")));
}
