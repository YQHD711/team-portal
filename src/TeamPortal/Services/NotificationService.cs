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
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
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
            }
            catch (Exception ex)
            {
                _log.Error("notification", $"Failed to persist {batch.Count} notification(s): {ex.Message}", ex.ToString());
            }
        }
    }

    /// <summary>
    /// Send a notification. userId == null → broadcast filtered by targetRole.
    /// targetRole == null → visible to all; "staff" → admin+部长; "admin" → admin only.
    /// </summary>
    public void Notify(string title, string message, string? link = null, int? userId = null, string? targetRole = null)
    {
        _channel.Writer.TryWrite(new Notification
        {
            Title = title, Message = message, Link = link, UserId = userId,
            TargetRole = targetRole, CreatedAt = DateTime.UtcNow
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

    public async Task MarkRead(long id)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var n = await db.Notifications.FindAsync(id);
        if (n != null) { n.IsRead = true; await db.SaveChangesAsync(); }
    }

    public async Task MarkAllRead(int userId, string? role)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Notifications.Where(n => !n.IsRead && (
            n.UserId == userId ||
            (n.UserId == null && (n.TargetRole == null ||
                (n.TargetRole == "staff" && (role == "admin" || role == "部长")) ||
                (n.TargetRole == "admin" && role == "admin")))))
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
    }
}
