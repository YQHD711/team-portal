using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class InventoryEndpoints
{
    private static async Task<(string? role, string? dept)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }

    private static bool IsStaff(string? role) => role == "admin" || role == "部长";

    private static readonly string[] UnsafeNameFragments = ["<script", "<img", "onerror=", "javascript:"];
    private static bool HasUnsafeName(string name) =>
        UnsafeNameFragments.Any(f => name.Contains(f, StringComparison.OrdinalIgnoreCase));

    public static void MapInventoryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/inventory").RequireAuthorization();

        group.MapGet("/", async (string? search, string? category, InventoryService svc) =>
        {
            var items = await svc.GetAll(search, category);
            return Results.Ok(items);
        });

        group.MapGet("/{id:int}", async (int id, InventoryService svc) =>
        {
            var item = await svc.GetById(id);
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapPost("/", async (CreateItemRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可创建零件", statusCode: 403);

            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.Problem("Name is required", statusCode: 400);
            if (req.Quantity < 0 || req.Quantity > 1_000_000)
                return Results.Problem(req.Quantity < 0 ? "数量不能为负数" : "数量超出合理范围(上限1000000)", statusCode: 400);
            if (req.UnitPrice is < 0)
                return Results.Problem("价格不能为负数", statusCode: 400);
            if (HasUnsafeName(req.Name))
                return Results.Problem("名称包含非法字符", statusCode: 400);

            var item = await svc.Create(req.Name, req.Category ?? "", req.Quantity,
                req.Grade ?? "C", req.UnitPrice ?? 0, req.DepartmentId, req.ProjectTag, req.LocationCode);
            log.Info("inventory", $"Part added: {item.Name} (qty {item.Quantity}) by {user.Identity?.Name}");
            log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "item", targetId: item.Id.ToString(),
                data: new { name = item.Name, quantity = item.Quantity, category = req.Category, grade = req.Grade }, ipAddress: LogService.ClientIp(ctx));
            return Results.Created($"/api/inventory/{item.Id}", item);
        });

        group.MapPost("/import", async (ImportRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可导入零件", statusCode: 403);

            if (string.IsNullOrWhiteSpace(req.FilePath))
                return Results.Problem("FilePath is required", statusCode: 400);

            var count = await svc.ImportFromExcel(req.FilePath);
            log.Info("inventory", $"Parts imported from {req.FilePath}: {count} items by {user.Identity?.Name}");
            log.Audit("import", user.Identity?.Name ?? "unknown", targetType: "item",
                data: new { imported = count, filePath = req.FilePath }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { imported = count });
        });

        group.MapPut("/{id:int}", async (int id, UpdateItemRequest req, InventoryService svc, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可修改零件", statusCode: 403);

            if (req.Quantity is < 0 || req.Quantity > 1_000_000)
                return Results.Problem(req.Quantity < 0 ? "数量不能为负数" : "数量超出合理范围(上限1000000)", statusCode: 400);
            if (req.UnitPrice is < 0)
                return Results.Problem("价格不能为负数", statusCode: 400);
            if (req.Name is not null && HasUnsafeName(req.Name))
                return Results.Problem("名称包含非法字符", statusCode: 400);

            var item = await svc.Update(id,
                req.Name, req.Quantity, req.Status,
                req.Grade, req.UnitPrice, req.DepartmentId, req.ProjectTag, req.LocationCode);
            if (item is not null)
            {
                var actor = user.Identity?.Name ?? "unknown";
                log.Info("inventory", $"Part updated: {item.Name} by {actor}");
                log.Audit("update", actor, targetType: "item", targetId: id.ToString(),
                    data: new { name = item.Name, grade = req.Grade, unitPrice = req.UnitPrice, locationCode = req.LocationCode },
                    ipAddress: LogService.ClientIp(ctx));
                if (item.Quantity > 0 && item.Quantity <= 3)
                    notify.Notify("库存预警", $"零件「{item.Name}」库存仅剩 {item.Quantity} 件", "/inventory", targetRole: "staff", level: "warning");
            }
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapDelete("/{id:int}", async (int id, InventoryService svc, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除零件", statusCode: 403);

            var item = await svc.GetById(id);
            var deleted = await svc.Delete(id);
            if (deleted)
            {
                var actor = user.Identity?.Name ?? "unknown";
                log.Warn("inventory", $"Part deleted: {item?.Name} (#{id}) by {actor}");
                log.Audit("delete", actor, targetType: "item", targetId: id.ToString(),
                    data: new { name = item?.Name }, ipAddress: LogService.ClientIp(ctx));
                notify.Notify("零件已删除", $"{actor} 删除了 {item?.Name}", targetRole: "staff");
            }
            return deleted ? Results.Ok(new { deleted = true }) : Results.Problem("Not found", statusCode: 404);
        });

        // Upload photo for a part → store in cloud, save view URL
        group.MapPost("/{id:int}/photo", async (int id, IFormFile file, InventoryService svc, BaiduNetdiskService baidu, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可上传零件照片", statusCode: 403);

            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);
            if (file.Length > 10 * 1024 * 1024) return Results.Problem("Photo too large (max 10MB)", statusCode: 400);

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (ext is not ".jpg" and not ".jpeg" and not ".png" and not ".gif" and not ".webp")
                return Results.Problem("Only image files accepted", statusCode: 400);

            var item = await svc.GetById(id);
            if (item is null) return Results.Problem("Part not found", statusCode: 404);

            if (!await baidu.IsConfigured()) return Results.Problem("Cloud storage not configured", statusCode: 400);

            // Upload photo to cloud
            var tmpPath = Path.GetTempFileName();
            await using (var fs = File.Create(tmpPath))
                await file.CopyToAsync(fs);

            var cloudFileName = $"part-{id}-{DateTime.Now:yyyyMMddHHmmss}{ext}";
            var remotePath = $"{BaiduNetdiskService.RootDir}/user-data/photos-videos/{cloudFileName}";
            await baidu.UploadFile(tmpPath, remotePath);
            File.Delete(tmpPath);

            // Save photo URL to item (use path-based view)
            var photoUrl = $"/api/baidu/view-by-path?path={Uri.EscapeDataString(remotePath)}";
            await svc.SetPhoto(id, photoUrl);
            log.Info("inventory", $"Photo uploaded for part #{id}: {item.Name} by {user.Identity?.Name ?? "unknown"}");
            notify.Notify("零件照片已上传", $"{item.Name} 的照片已保存到云存储", "/inventory", targetRole: "staff");
            return Results.Ok(new { success = true, photoUrl });
        }).DisableAntiforgery();

        // Check-out items (reduce quantity + log transaction) — atomic UPDATE for concurrency safety
        group.MapPost("/{id:int}/checkout", async (int id, TransactionRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可借出零件", statusCode: 403);

            if (req.Quantity <= 0) return Results.Problem("Quantity must be positive", statusCode: 400);
            var item = await svc.GetById(id);
            if (item is null) return Results.Problem("Part not found", statusCode: 404);

            var userName = user.Identity?.Name ?? "unknown";
            // Atomic decrement: only succeeds if enough stock remains
            var updated = await db.InventoryItems
                .Where(i => i.Id == id && i.Quantity >= req.Quantity)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(i => i.Quantity, i => i.Quantity - req.Quantity)
                    .SetProperty(i => i.UpdatedAt, DateTime.UtcNow));
            if (updated == 0) return Results.Problem("库存不足或已被他人修改，请刷新重试", statusCode: 409);

            var newQty = item.Quantity - req.Quantity;
            db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = id, Type = "checkout", Quantity = req.Quantity,
                UserName = userName, Note = req.Note
            });
            await db.SaveChangesAsync();

            log.Info("inventory", $"Checkout: {item.Name} -{req.Quantity} by {userName} (now {newQty})");
            log.Audit("checkout", userName, targetType: "item", targetId: id.ToString(),
                data: new { name = item.Name, quantity = req.Quantity, remaining = newQty }, ipAddress: LogService.ClientIp(ctx));
            if (newQty >= 0 && newQty <= InventoryService.LowStockThreshold)
                notify.Notify("库存预警", $"零件「{item.Name}」库存仅剩 {newQty} 件（{userName} 借出 {req.Quantity} 个）", "/inventory", targetRole: "staff", level: "warning");
            return Results.Ok(new { success = true, quantity = newQty, message = $"已借出 {req.Quantity} 个 {item.Name}" });
        });

        // Check-in items (increase quantity + log transaction) — atomic UPDATE for concurrency safety
        group.MapPost("/{id:int}/checkin", async (int id, TransactionRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可归还零件", statusCode: 403);

            if (req.Quantity <= 0) return Results.Problem("Quantity must be positive", statusCode: 400);
            var item = await svc.GetById(id);
            if (item is null) return Results.Problem("Part not found", statusCode: 404);

            var userName = user.Identity?.Name ?? "unknown";
            var updated = await db.InventoryItems
                .Where(i => i.Id == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(i => i.Quantity, i => i.Quantity + req.Quantity)
                    .SetProperty(i => i.UpdatedAt, DateTime.UtcNow));
            if (updated == 0) return Results.Problem("零件不存在", statusCode: 404);

            var newQty = item.Quantity + req.Quantity;
            db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = id, Type = "checkin", Quantity = req.Quantity,
                UserName = userName, Note = req.Note
            });
            await db.SaveChangesAsync();

            log.Info("inventory", $"Checkin: {item.Name} +{req.Quantity} by {userName} (now {newQty})");
            log.Audit("checkin", userName, targetType: "item", targetId: id.ToString(),
                data: new { name = item.Name, quantity = req.Quantity, total = newQty }, ipAddress: LogService.ClientIp(ctx));
            if (newQty > 3)
                notify.Notify("库存恢复", $"零件「{item.Name}」库存已恢复至 {newQty} 件", "/inventory", targetRole: "staff");
            return Results.Ok(new { success = true, quantity = newQty, message = $"已归还 {req.Quantity} 个 {item.Name}" });
        });

        // Quick consume — for C-level consumables (no approval, no return)
        group.MapPost("/{id:int}/consume", async (int id, TransactionRequest req, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可消耗零件", statusCode: 403); // D-3 fix
            var userName = user.Identity?.Name ?? "unknown";
            if (req.Quantity <= 0) return Results.Problem("数量必须大于0", statusCode: 400);
            var item = await db.InventoryItems.FindAsync(id);
            if (item is null) return Results.Problem("零件不存在", statusCode: 404);
            if (item.Quantity < req.Quantity) return Results.Problem("库存不足", statusCode: 400);

            var updated = await db.InventoryItems
                .Where(i => i.Id == id && i.Quantity >= req.Quantity)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(i => i.Quantity, i => i.Quantity - req.Quantity)
                    .SetProperty(i => i.UpdatedAt, DateTime.UtcNow));
            if (updated == 0) return Results.Problem("库存不足", statusCode: 409);

            db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = id, Type = "consume", Quantity = req.Quantity,
                UserName = userName, Note = req.Note
            });
            await db.SaveChangesAsync();

            var newQty = item.Quantity - req.Quantity;
            log.Info("inventory", $"Consumed: {item.Name} -{req.Quantity} by {userName} (now {newQty})");
            if (newQty <= InventoryService.LowStockThreshold)
                notify.Notify("库存预警", $"耗材「{item.Name}」仅剩 {newQty} 件", "/inventory", targetRole: "staff", level: "warning");
            return Results.Ok(new { success = true, quantity = newQty, message = $"已消耗 {req.Quantity} 个 {item.Name}" });
        });

        // Get transaction history for an item
        group.MapGet("/{id:int}/transactions", async (int id, AppDbContext db) =>
        {
            var txns = await Task.Run(() => db.InventoryTransactions
                .Where(t => t.InventoryItemId == id)
                .OrderByDescending(t => t.CreatedAt)
                .Take(50)
                .Select(t => new { t.Id, t.Type, t.Quantity, t.UserName, t.Note, t.CreatedAt })
                .ToList());
            return Results.Ok(txns);
        });
    }
}

public record CreateItemRequest(string Name, string? Category, int Quantity,
    string? Grade, decimal? UnitPrice, int? DepartmentId, string? ProjectTag, string? LocationCode);
public record UpdateItemRequest(
    string? Name, int? Quantity, string? Status,
    string? Grade, decimal? UnitPrice, int? DepartmentId, string? ProjectTag, string? LocationCode);
public record ImportRequest(string FilePath);
public record TransactionRequest(int Quantity, string? Note);
