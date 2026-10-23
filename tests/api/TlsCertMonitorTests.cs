using TeamPortal.Services;

namespace api;

/// <summary>
/// TLS 证书到期阈值（纯函数）：剩余 >7 天 info、<=7 天 warn、<=3 天 error（已过期同样 error）。
/// 每日维护任务按这个级别写 SystemLog category="tls"；阈值错了会漏掉续期预警。
/// </summary>
public class TlsCertMonitorTests
{
    [Theory]
    [InlineData(90, "info")]
    [InlineData(7.5, "info")]
    [InlineData(7.01, "info")]
    [InlineData(7, "warn")]
    [InlineData(6, "warn")]
    [InlineData(3.01, "warn")]
    [InlineData(3, "error")]
    [InlineData(1, "error")]
    [InlineData(0, "error")]
    [InlineData(-1, "error")]
    public void SeverityFor_MapsRemainingDaysToLevel(double daysRemaining, string expected)
        => Assert.Equal(expected, TlsCertMonitor.SeverityFor(daysRemaining));

    [Fact]
    public void Check_WithoutCertPath_IsNoOp()
    {
        // 未配置 Tls:CertPath（默认）→ 直接跳过，不抛异常也不写日志
        TlsCertMonitor.Check(null!, null);
        TlsCertMonitor.Check(null!, "   ");
    }
}
