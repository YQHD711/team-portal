using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// TLS 证书到期监控（每日维护任务调用）。
///  - 证书路径来自配置 Tls:CertPath（PEM，默认空 → 直接跳过，未启用 HTTPS 的部署不产生噪声）；
///  - 用 X509Certificate2.CreateFromPemFile 解析（Let's Encrypt fullchain.pem 即 PEM）；
///  - 剩余天数 &gt; 7 天 info、&lt;= 7 天 warn、&lt;= 3 天 error，写 SystemLog category="tls"；
///  - 文件缺失/解析失败只记 warn，**不抛异常**，不影响每日维护任务的其它步骤。
/// </summary>
public static class TlsCertMonitor
{
    public const string Category = "tls";
    public const int WarnDays = 7;
    public const int ErrorDays = 3;

    /// <summary>剩余天数 → 日志级别（纯函数，便于单测）：&gt;7 天 info、&lt;=7 天 warn、&lt;=3 天 error（含已过期）。</summary>
    public static string SeverityFor(double daysRemaining)
        => daysRemaining <= ErrorDays ? "error" : daysRemaining <= WarnDays ? "warn" : "info";

    /// <summary>解析 PEM 证书并写一条 category="tls" 的系统日志；本方法内部吞掉所有异常。</summary>
    public static void Check(LogService? log, string? certPath)
    {
        if (log is null) return;
        if (string.IsNullOrWhiteSpace(certPath)) return; // 默认空 → 跳过

        try
        {
            if (!File.Exists(certPath))
            {
                log.Warn(Category, $"TLS 证书文件不存在：{certPath}（检查 Tls:CertPath 与容器挂载）");
                return;
            }

            using var cert = X509Certificate2.CreateFromPemFile(certPath);
            var days = (cert.NotAfter.ToUniversalTime() - DateTime.UtcNow).TotalDays;
            var detail = JsonSerializer.Serialize(new
            {
                path = certPath,
                subject = cert.Subject,
                issuer = cert.Issuer,
                notAfter = cert.NotAfter.ToUniversalTime().ToString("O"),
                daysRemaining = Math.Round(days, 1),
            });
            log.Log(SeverityFor(days), Category,
                $"TLS 证书到期检查：{cert.Subject} 将于 {cert.NotAfter.ToUniversalTime():yyyy-MM-dd} UTC 到期，剩余 {days:F1} 天", detail);
        }
        catch (Exception ex)
        {
            // 格式错误/权限不足等：留一条可查的 warn，绝不让每日维护任务崩溃
            log.Warn(Category, $"TLS 证书解析失败：{ex.GetType().Name}: {ex.Message}");
        }
    }
}
