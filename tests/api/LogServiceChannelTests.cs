using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Services;

namespace api;

/// <summary>LogService channel 丢弃可观测性 —— 覆盖 P0:DropOldest 下 TryWrite 恒 true 使丢弃计数恒为 0。</summary>
public class LogServiceChannelTests
{
    [Fact]
    public void Log_ChannelFull_CountsDrops()
    {
        // 消费者被卡在 CreateScope(每次 1 秒),保证 channel 必然积压满
        using var svc = new LogService(new BlockingScopeFactory(), NullLogger<LogService>.Instance, null!);

        for (var i = 0; i < 6000; i++) svc.Log("info", "test", $"msg-{i}");

        var stats = svc.GetChannelStats();
        Assert.True(stats.SysDropped > 0, $"预期丢弃计数 > 0,实际 {stats.SysDropped}");
        Assert.True(stats.SysPending > 0);
    }

    [Fact]
    public void NewService_NoDrops()
    {
        using var svc = new LogService(new TestScopeFactory(null!), NullLogger<LogService>.Instance, null!);

        svc.Log("info", "test", "one");
        svc.Audit("login", "tester");

        var stats = svc.GetChannelStats();
        Assert.Equal(0, stats.SysDropped);
        Assert.Equal(0, stats.AuditDropped);
    }

    private sealed class BlockingScopeFactory : IServiceScopeFactory
    {
        public IServiceScope CreateScope()
        {
            Thread.Sleep(1000);
            throw new InvalidOperationException("no db in this test");
        }
    }
}
