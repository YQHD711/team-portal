using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        app.MapGet("/api/dashboard", async (AppDbContext db) =>
        {
            var now = DateTime.UtcNow;
            var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

            // Base stats
            var userCount = await db.Users.CountAsync();
            var invCount = await db.InventoryItems.CountAsync();
            var invTotal = await db.InventoryItems.SumAsync(i => i.Quantity);
            var deptCount = await db.Departments.CountAsync();

            // Finance stats
            var pendingRequests = await db.PurchaseRequests.CountAsync(r => r.Status == "pending");
            var monthSpent = await db.PurchaseRequests.Where(r => r.Status == "received" && r.ReceivedAt >= monthStart).SumAsync(r => r.ActualPrice ?? r.EstimatedPrice);

            // Low stock
            var lowStock = await db.InventoryItems.Where(i => i.Quantity < 5 && i.Quantity > 0).OrderBy(i => i.Quantity).Take(5).Select(i => new { i.Id, i.Name, i.Quantity, i.Category }).ToListAsync();

            // Active wiki tasks
            var activeWiki = await db.WikiTasks.Where(w => w.Status != "completed" && w.Status != "failed").OrderByDescending(w => w.CreatedAt).Take(3).Select(w => new { w.Id, w.ProjectName, w.Status, w.CreatedAt }).ToListAsync();

            // Recent incidents
            var recentIncidents = await db.IncidentRecords.OrderByDescending(i => i.Date).Take(3).Select(i => new { i.Id, i.Type, i.Severity, i.Description, i.Date }).ToListAsync();

            // Completed wiki count
            var completedWiki = await db.WikiTasks.CountAsync(w => w.Status == "completed");

            return Results.Ok(new
            {
                users = userCount, inventory = invCount, inventoryTotal = invTotal, departments = deptCount,
                pendingPurchases = pendingRequests, monthSpent = Math.Round(monthSpent, 0),
                lowStock, activeWiki, recentIncidents, completedWiki
            });
        }).RequireAuthorization();
    }
}
