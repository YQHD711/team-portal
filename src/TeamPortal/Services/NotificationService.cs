using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class NotificationService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly Channel<Notification> _channel;
    private readonly LogService _log;
    // SSE 订阅:key = userId + ":" + role,null 表示未登录(广播)
    private readonly ConcurrentDictionary<string, List<Channel<Notification>>> _subscribers = new();

    public NotificationService(IServiceScopeFactory scopeFactory, LogService log)
    {
        _scopeFactory = scopeFactory;
        _log = log;
        _channel = Channel.CreateBounded<Notification>(new BoundedChannelOptions(500)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });
        _ = ProcessChannel();
    }

    private async Task ProcessChannel()
    {
        var batch = new List<Notification>(10);
        while (true)
        {
            try
            {
                batch.Clear();
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
                try
                {
                    while (batch.Count < 10)
                    {
                        var entry = await _channel.Reader.ReadAsync(timeoutCts.Token);
                        batch.Add(entry);
                    }
                }
                catch (OperationCanceledException) { /* timeout — flush */ }
            }
            catch (Exception ex)
            {
                _log.Error("notification", $"Channel error, retrying in 5s: {ex.Message}");
                try { await Task.Delay(5000); } catch { break; }
            }

            if (batch.Count == 0) continue;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Notifications.AddRange(batch);
                await db.SaveChangesAsync();

                // SSE fan-out:遍历订阅者,按可见性规则投递
                foreach (var n in batch) FanOut(n);
            }
            catch (Exception ex)
            {
                _log.Error("notification", $"Failed to persist {batch.Count} notification(s): {ex.Message}", ex.ToString());
            }
        }
    }

    /// <summary>检查通知是否对该 (userId, role) 可见(与 GetNotifications 同步)</summary>
    public static bool IsVisibleTo(Notification n, int userId, string? role)
    {
        if (n.UserId == userId) return true;
        if (n.UserId != null) return false;
        if (n.TargetRole == null) return true;
        if (nTargetRoleMatches(n.TargetRole, role)) return true;
        return false;
        static bool nTargetRoleMatches(string target, string? r) => target switch
        {
            "staff" => r == "admin" || r == "部长",
            "admin" => r == "admin",
            _ => false
        };
    }

    private void FanOut(Notification n)
    {
        foreach (var kv in _subscribers)
        {
            // key 格式 "userId:role",解析后做可见性判断
            var parts = kv.Key.Split(':', 2);
            if (parts.Length != 2 || !int.TryParse(parts[0], out var uid)) continue;
            var role = parts[1] == "null" ? null : parts[1];
            if (!IsVisibleTo(n, uid, role)) continue;
            lock (kv.Value)
            {
                foreach (var ch in kv.Value)
                    ch.Writer.TryWrite(n);
            }
        }
    }

    /// <summary>订阅 SSE 流。返回 ChannelReader 与一个释放时取消订阅的 IDisposable。</summary>
    public IDisposable Subscribe(int userId, string? role, out ChannelReader<Notification> reader)
    {
        var ch = Channel.CreateBounded<Notification>(new BoundedChannelOptions(100)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true
        });
        reader = ch.Reader;
        var key = $"{userId}:{role ?? "null"}";
        var list = _subscribers.GetOrAdd(key, _ => new List<Channel<Notification>>());
        lock (list) list.Add(ch);
        return new Subscription(this, key, ch);
    }

    private void Unsubscribe(string key, Channel<Notification> ch)
    {
        if (_subscribers.TryGetValue(key, out var list))
        {
            lock (list) list.Remove(ch);
            if (list.Count == 0) _subscribers.TryRemove(key, out _);
        }
    }

    private sealed class Subscription : IDisposable
    {
        private readonly NotificationService _svc;
        private readonly string _key;
        private readonly Channel<Notification> _ch;
        public Subscription(NotificationService svc, string key, Channel<Notification> ch)
        { _svc = svc; _key = key; _ch = ch; }
        public void Dispose() { _ch.Writer.TryComplete(); _svc.Unsubscribe(_key, _ch); }
    }

    /// <summary>
    /// Send a notification. userId == null → broadcast filtered by targetRole.
    /// targetRole == null → visible to all; "staff" → admin+部长; "admin" → admin only.
    /// </summary>
    public void Notify(string title, string message, string? link = null, int? userId = null,
        string? targetRole = null, string level = "info", string? payloadJson = null)
    {
        _channel.Writer.TryWrite(new Notification
        {
            Title = title, Message = message, Link = link, UserId = userId,
            TargetRole = targetRole, Level = level, PayloadJson = payloadJson,
            CreatedAt = DateTime.UtcNow
        });
    }

    /// <summary>
    /// Get notifications visible to a given user (public + their own personal ones), respecting role filters.
    /// </summary>
    public async Task<List<Notification>> GetNotifications(int userId, string? role, bool unreadOnly = false)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.Notifications.Where(n =>
            n.UserId == userId ||
            (n.UserId == null && (n.TargetRole == null ||
                (n.TargetRole == "staff" && (role == "admin" || role == "部长")) ||
                (n.TargetRole == "admin" && role == "admin"))));
        if (unreadOnly) query = query.Where(n => !n.IsRead);
        return await query.OrderByDescending(n => n.Id).Take(50).ToListAsync();
    }

    public async Task<int> GetUnreadCount(int userId, string? role)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Notifications.CountAsync(n => !n.IsRead && (
            n.UserId == userId ||
            (n.UserId == null && (n.TargetRole == null ||
                (n.TargetRole == "staff" && (role == "admin" || role == "部长")) ||
                (n.TargetRole == "admin" && role == "admin")))));
    }

    /// <summary>
    /// Mark a notification read only if it is visible to the given user.
    /// Returns false when the notification is missing or not visible to them.
    /// </summary>
    public async Task<bool> MarkReadIfVisible(long id, int userId, string? role)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var n = await db.Notifications.FindAsync(id);
        if (n is null) return false;
        if (!IsVisibleTo(n, userId, role)) return false;
        if (!n.IsRead) { n.IsRead = true; await db.SaveChangesAsync(); }
        return true;
    }

    public async Task MarkAllRead(int userId, string? role)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // 内联表达式(EFCore 无法把 IsVisibleTo 翻译到 SQL;直接展开)
        await db.Notifications.Where(n => !n.IsRead && (
            n.UserId == userId ||
            (n.UserId == null && (n.TargetRole == null ||
                (n.TargetRole == "staff" && (role == "admin" || role == "部长")) ||
                (n.TargetRole == "admin" && role == "admin")))))
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
    }
}
