using System.Threading.Channels;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Reliable centralized logging — channel-based async writes, auto-cleanup, stats.
/// SystemLog(请求/运行日志)与 OperationLog(业务操作审计)分离存储,各自独立 channel 批量写入。
/// 按职责拆分为 partial:Workers(批量落库) / Audit(脱敏写入) / Query / Export / Cleanup。
/// </summary>
public partial class LogService : IDisposable
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LogService> _logger;
    private readonly SettingsService _settings;
    private readonly Channel<SystemLog> _channel;
    private readonly Channel<OperationLog> _auditChannel;
    private readonly CancellationTokenSource _cts = new();

    private long _auditDropped;
    private long _sysDropped;
    private long _lastOpPruneTicks;

    public LogService(IServiceScopeFactory scopeFactory, ILogger<LogService> logger, SettingsService settings)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _settings = settings;
        _channel = Channel.CreateBounded<SystemLog>(new BoundedChannelOptions(5000)
        {
            // Wait + 检查 TryWrite 返回值:DropOldest/DropNewest/DropWrite 下 TryWrite 恒为 true,
            // 丢弃量无法计数(实测 .NET 10),审计与排障会因此失去可观测性。
            // Wait 模式 TryWrite 不会阻塞,队列满时立即返回 false。
            FullMode = BoundedChannelFullMode.Wait
        });
        _auditChannel = Channel.CreateBounded<OperationLog>(new BoundedChannelOptions(5000)
        {
            FullMode = BoundedChannelFullMode.Wait
        });
        _ = ProcessChannel(_cts.Token);
        _ = ProcessAuditChannel(_cts.Token);
    }

    /// <summary>从请求上下文提取客户端 IP(IPv4-mapped IPv6 归一为 IPv4)</summary>
    public static string? ClientIp(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress?.ToString();
        return ip?.StartsWith("::ffff:", StringComparison.OrdinalIgnoreCase) == true ? ip[7..] : ip;
    }

    public void Log(string level, string category, string message, string? detail = null, string? userName = null)
    {
        // Console mirror (always immediate)
        _logger.Log(level switch { "error" => LogLevel.Error, "warn" => LogLevel.Warning, _ => LogLevel.Information },
            "[{Cat}] {Msg}", category, message);

        // Async enqueue — non-blocking
        var entry = new SystemLog
        {
            Level = level, Category = category, Message = message,
            Detail = detail, UserName = userName, CreatedAt = DateTime.UtcNow
        };
        if (!_channel.Writer.TryWrite(entry)) Interlocked.Increment(ref _sysDropped);
    }

    public void Info(string cat, string msg, string? detail = null, string? user = null) => Log("info", cat, msg, detail, user);
    public void Warn(string cat, string msg, string? detail = null, string? user = null) => Log("warn", cat, msg, detail, user);
    public void Error(string cat, string msg, string? detail = null, string? user = null) => Log("error", cat, msg, detail, user);

    /// <summary>channel 积压 / 丢弃计数,供健康检查与运维观测(无需访问 DB)。</summary>
    public (int SysPending, long SysDropped, int AuditPending, long AuditDropped) GetChannelStats()
        => (_channel.Reader.Count, Interlocked.Read(ref _sysDropped),
            _auditChannel.Reader.Count, Interlocked.Read(ref _auditDropped));

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}
