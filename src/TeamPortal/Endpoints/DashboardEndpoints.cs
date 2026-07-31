using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Endpoints;

public static class DashboardEndpoints
{
    private const int LowStockThreshold = 5;

    public static void MapDashboardEndpoints(this WebApplication app)
    {
        app.MapGet("/api/dashboard", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var now = DateTime.UtcNow;
            var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var role = user.FindFirstValue(ClaimTypes.Role);
            var isStaff = role == "admin" || role == "部长";

            // Independent aggregate queries run in parallel (single round-trip latency).
            var usersTask = db.Users.CountAsync();
            var inventoryTask = db.InventoryItems.CountAsync();
            var inventoryTotalTask = db.InventoryItems.SumAsync(i => i.Quantity);
            var departmentsTask = db.Departments.CountAsync();
            var monthNewItemsTask = db.InventoryItems.CountAsync(i => i.CreatedAt >= monthStart);
            var lowStockTask = db.InventoryItems
                .Where(i => i.Quantity < LowStockThreshold && i.Quantity > 0)
                .OrderBy(i => i.Quantity).Take(5)
                .Select(i => new { i.Id, i.Name, i.Quantity, i.Category }).ToListAsync();
            var activeWikiTask = db.WikiTasks
                .Where(w => w.Status != "completed" && w.Status != "failed")
                .OrderByDescending(w => w.CreatedAt).Take(3)
                .Select(w => new { w.Id, w.ProjectName, w.Status, w.CreatedAt }).ToListAsync();
            var recentIncidentsTask = db.IncidentRecords
                .OrderByDescending(i => i.Date).Take(3)
                .Select(i => new { i.Id, i.Type, i.Severity, i.Description, i.Date }).ToListAsync();
            var completedWikiTask = db.WikiTasks.CountAsync(w => w.Status == "completed");

            // Financial stats are staff-only — never queried for regular members.
            Task<int>? pendingRequestsTask = null;
            Task<decimal>? monthSpentTask = null;
            Task<decimal>? inventoryValueTask = null;
            if (isStaff)
            {
                pendingRequestsTask = db.PurchaseRequests.CountAsync(r => r.Status == "pending");
                monthSpentTask = db.PurchaseRequests
                    .Where(r => (r.Status == "received" && r.ReceivedAt >= monthStart)
                             || (r.Status == "purchased" && r.PurchasedAt >= monthStart))
                    .SumAsync(r => r.ActualPrice ?? r.EstimatedPrice);
                inventoryValueTask = db.InventoryItems.SumAsync(i => i.UnitPrice * i.Quantity);
            }

            await Task.WhenAll(new Task[] { usersTask, inventoryTask, inventoryTotalTask, departmentsTask,
                monthNewItemsTask, lowStockTask, activeWikiTask, recentIncidentsTask, completedWikiTask }
                .Concat(isStaff ? new Task[] { pendingRequestsTask!, monthSpentTask!, inventoryValueTask! } : []));

            if (!isStaff)
            {
                return Results.Ok(new
                {
                    users = await usersTask, inventory = await inventoryTask,
                    inventoryTotal = await inventoryTotalTask, departments = await departmentsTask,
                    monthNewItems = await monthNewItemsTask, lowStock = await lowStockTask,
                    activeWiki = await activeWikiTask, recentIncidents = await recentIncidentsTask,
                    completedWiki = await completedWikiTask,
                });
            }

            return Results.Ok(new
            {
                users = await usersTask, inventory = await inventoryTask,
                inventoryTotal = await inventoryTotalTask, departments = await departmentsTask,
                monthNewItems = await monthNewItemsTask, lowStock = await lowStockTask,
                activeWiki = await activeWikiTask, recentIncidents = await recentIncidentsTask,
                completedWiki = await completedWikiTask,
                pendingPurchases = await pendingRequestsTask!, monthSpent = Math.Round(await monthSpentTask!, 2),
                inventoryValue = Math.Round(await inventoryValueTask!, 2),
            });
        }).RequireAuthorization();
    }
}
