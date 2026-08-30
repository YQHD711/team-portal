using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Endpoints;

public static class DashboardEndpoints
{
    private const int LowStockThreshold = 5;
    // 性能 #1:仪表盘聚合缓存 15s(弱实时数据可容忍陈旧)
    private static readonly ConcurrentDictionary<string, CacheEntry> _cache = new();
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(15);

    private sealed class CacheEntry
    {
        public required object Payload { get; init; }
        public required DateTime ExpiresAt { get; init; }
        public bool Valid => DateTime.UtcNow < ExpiresAt;
    }

    public static void MapDashboardEndpoints(this WebApplication app)
    {
        app.MapGet("/api/dashboard", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            var isStaff = role == "admin" || role == "部长";
            var cacheKey = isStaff ? "staff" : "member";

            // 命中未过期缓存:直接返回(零 DB 查询)
            if (_cache.TryGetValue(cacheKey, out var entry) && entry.Valid)
                return Results.Ok(entry.Payload);

            var now = DateTime.UtcNow;
            var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

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

            // 性能 #15:不再让前端拉全量库存只为分类聚合 → 后端直接返回分类计数
            var categoryCountsTask = db.InventoryItems
                .GroupBy(i => i.Category ?? "未分类")
                .Select(g => new { name = g.Key, count = g.Count() })
                .Take(5)
                .ToListAsync();

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
                monthNewItemsTask, lowStockTask, activeWikiTask, recentIncidentsTask, completedWikiTask, categoryCountsTask }
                .Concat(isStaff ? new Task[] { pendingRequestsTask!, monthSpentTask!, inventoryValueTask! } : []));

            object payload;
            if (!isStaff)
            {
                payload = new
                {
                    users = await usersTask, inventory = await inventoryTask,
                    inventoryTotal = await inventoryTotalTask, departments = await departmentsTask,
                    monthNewItems = await monthNewItemsTask, lowStock = await lowStockTask,
                    activeWiki = await activeWikiTask, recentIncidents = await recentIncidentsTask,
                    completedWiki = await completedWikiTask,
                    categoryCounts = await categoryCountsTask,
                };
            }
            else
            {
                payload = new
                {
                    users = await usersTask, inventory = await inventoryTask,
                    inventoryTotal = await inventoryTotalTask, departments = await departmentsTask,
                    monthNewItems = await monthNewItemsTask, lowStock = await lowStockTask,
                    activeWiki = await activeWikiTask, recentIncidents = await recentIncidentsTask,
                    completedWiki = await completedWikiTask,
                    categoryCounts = await categoryCountsTask,
                    pendingPurchases = await pendingRequestsTask!, monthSpent = Math.Round(await monthSpentTask!, 2),
                    inventoryValue = Math.Round(await inventoryValueTask!, 2),
                };
            }

            // 写入缓存(覆盖式更新)
            _cache[cacheKey] = new CacheEntry
            {
                Payload = payload,
                ExpiresAt = DateTime.UtcNow + CacheTtl
            };
            return Results.Ok(payload);
        }).RequireAuthorization();

        // 管理端失效缓存:数据变更后调用
        app.MapPost("/api/admin/dashboard/invalidate", (ClaimsPrincipal user) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            if (role != "admin" && role != "部长") return Results.Forbid();
            _cache.Clear();
            return Results.Ok(new { cleared = true });
        }).RequireAuthorization("StaffOnly");
    }
}
