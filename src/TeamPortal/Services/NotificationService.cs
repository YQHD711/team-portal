using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class NotificationService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly Channel<Notification> _channel;

    public NotificationService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
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
            catch { break; }

            if (batch.Count == 0) continue;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Notifications.AddRange(batch);
                await db.SaveChangesAsync();
            }
            catch { }
        }
    }

    public void Notify(string title, string message, string? link = null)
    {
        _channel.Writer.TryWrite(new Notification
        {
            Title = title, Message = message, Link = link,
            CreatedAt = DateTime.UtcNow
        });
    }

    public async Task<List<Notification>> GetNotifications(bool unreadOnly = false)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.Notifications.AsQueryable();
        if (unreadOnly) query = query.Where(n => !n.IsRead);
        return await query.OrderByDescending(n => n.Id).Take(50).ToListAsync();
    }

    public async Task<int> GetUnreadCount()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Notifications.CountAsync(n => !n.IsRead);
    }

    public async Task MarkRead(long id)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var n = await db.Notifications.FindAsync(id);
        if (n != null) { n.IsRead = true; await db.SaveChangesAsync(); }
    }

    public async Task MarkAllRead()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Notifications.Where(n => !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
    }
}
