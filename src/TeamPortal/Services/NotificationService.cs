using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class NotificationService
{
    private readonly IServiceScopeFactory _scopeFactory;

    public NotificationService(IServiceScopeFactory scopeFactory) { _scopeFactory = scopeFactory; }

    public void Notify(string title, string message, string? link = null)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Notifications.Add(new Notification { Title = title, Message = message, Link = link });
                await db.SaveChangesAsync();
            }
            catch { }
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
        await db.Notifications.Where(n => !n.IsRead).ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true));
    }
}
