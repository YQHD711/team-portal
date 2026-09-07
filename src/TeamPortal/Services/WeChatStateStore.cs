using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace TeamPortal.Services;

/// <summary>
/// 微信 OAuth state 存储：防 CSRF。内存实现，5 分钟 TTL，单次消费。
/// 单实例部署够用；多实例需换 Redis（留 TODO）。
/// </summary>
public class WeChatStateStore
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, DateTime> _states = new();

    public string Generate()
    {
        Cleanup();
        var state = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        _states[state] = DateTime.UtcNow.AddTicks(Ttl.Ticks);
        return state;
    }

    public Task<string> GenerateAsync() => Task.FromResult(Generate());

    /// <summary>校验并消费 state（单次有效，防重放）。</summary>
    public bool ValidateAndConsume(string state)
    {
        if (!_states.TryRemove(state, out var expiry)) return false;
        return expiry > DateTime.UtcNow;
    }

    public Task<bool> ValidateAndConsumeAsync(string state) => Task.FromResult(ValidateAndConsume(state));

    private void Cleanup()
    {
        var now = DateTime.UtcNow;
        foreach (var key in _states.Where(kv => kv.Value < now).Select(kv => kv.Key).ToList())
            _states.TryRemove(key, out _);
    }
}
