using System.Security.Claims;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class InventoryEndpoints
{
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

        group.MapPost("/", async (CreateItemRequest req, InventoryService svc) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.Problem("Name is required", statusCode: 400);

            var item = await svc.Create(req.Name, req.Category ?? "", req.Quantity, req.Location ?? "", req.Status ?? "available");
            return Results.Created($"/api/inventory/{item.Id}", item);
        });

        group.MapPost("/import", async (ImportRequest req, InventoryService svc) =>
        {
            if (string.IsNullOrWhiteSpace(req.FilePath))
                return Results.Problem("FilePath is required", statusCode: 400);

            var count = await svc.ImportFromExcel(req.FilePath);
            return Results.Ok(new { imported = count });
        });

        group.MapPut("/{id:int}", async (int id, UpdateItemRequest req, InventoryService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            var item = await svc.Update(id, req.Quantity, req.Location, req.Status);
            if (item is not null)
            {
                var actor = user.Identity?.Name ?? "unknown";
                log.Info("inventory", $"Part updated: {item.Name} qty→{item.Quantity} loc→{item.Location} by {actor}");
                if (item.Quantity > 0 && item.Quantity <= 3)
                    notify.Notify("库存预警", $"零件「{item.Name}」库存仅剩 {item.Quantity} 件", "/inventory");
            }
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapDelete("/{id:int}", async (int id, InventoryService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            var item = await svc.GetById(id);
            var deleted = await svc.Delete(id);
            if (deleted) { var actor = user.Identity?.Name ?? "unknown"; log.Warn("inventory", $"Part deleted: {item?.Name} (#{id}) by {actor}"); notify.Notify("零件已删除", $"{actor} 删除了 {item?.Name}"); }
            return deleted ? Results.Ok(new { deleted = true }) : Results.Problem("Not found", statusCode: 404);
        });

        // Upload photo for a part → store in cloud, save view URL
        group.MapPost("/{id:int}/photo", async (int id, IFormFile file, InventoryService svc, BaiduNetdiskService baidu, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
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
            notify.Notify("零件照片已上传", $"{item.Name} 的照片已保存到云存储", "/inventory");
            return Results.Ok(new { success = true, photoUrl });
        }).DisableAntiforgery();

        // Check-out items (reduce quantity + log transaction)
        group.MapPost("/{id:int}/checkout", async (int id, TransactionRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, NotificationService notify) =>
        {
            if (req.Quantity <= 0) return Results.Problem("Quantity must be positive", statusCode: 400);
            var item = await svc.GetById(id);
            if (item is null) return Results.Problem("Part not found", statusCode: 404);
            if (item.Quantity < req.Quantity) return Results.Problem($"Insufficient stock: have {item.Quantity}, need {req.Quantity}", statusCode: 400);

            var userName = user.Identity?.Name ?? "unknown";
            item.Quantity -= req.Quantity;
            item.UpdatedAt = DateTime.UtcNow;

            db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = id, Type = "checkout", Quantity = req.Quantity,
                UserName = userName, Note = req.Note
            });
            await db.SaveChangesAsync();

            log.Info("inventory", $"Checkout: {item.Name} -{req.Quantity} by {userName} (now {item.Quantity}){(req.Note is not null ? $", note: {req.Note}" : "")}");
            if (item.Quantity > 0 && item.Quantity <= 3)
                notify.Notify("库存预警", $"零件「{item.Name}」库存仅剩 {item.Quantity} 件（{userName} 借出 {req.Quantity} 个）", "/inventory");
            return Results.Ok(new { success = true, item.Quantity, message = $"已借出 {req.Quantity} 个 {item.Name}" });
        });

        // Check-in items (increase quantity + log transaction)
        group.MapPost("/{id:int}/checkin", async (int id, TransactionRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, NotificationService notify) =>
        {
            if (req.Quantity <= 0) return Results.Problem("Quantity must be positive", statusCode: 400);
            var item = await svc.GetById(id);
            if (item is null) return Results.Problem("Part not found", statusCode: 404);

            var userName = user.Identity?.Name ?? "unknown";
            item.Quantity += req.Quantity;
            item.UpdatedAt = DateTime.UtcNow;

            db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = id, Type = "checkin", Quantity = req.Quantity,
                UserName = userName, Note = req.Note
            });
            await db.SaveChangesAsync();

            log.Info("inventory", $"Checkin: {item.Name} +{req.Quantity} by {userName} (now {item.Quantity}){(req.Note is not null ? $", note: {req.Note}" : "")}");
            // Clear low-stock warning if stock is now healthy
            if (item.Quantity > 3)
                notify.Notify("库存恢复", $"零件「{item.Name}」库存已恢复至 {item.Quantity} 件", "/inventory");
            return Results.Ok(new { success = true, item.Quantity, message = $"已归还 {req.Quantity} 个 {item.Name}" });
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

public record CreateItemRequest(string Name, string? Category, int Quantity, string? Location, string? Status);
public record UpdateItemRequest(int? Quantity, string? Location, string? Status);
public record ImportRequest(string FilePath);
public record TransactionRequest(int Quantity, string? Note);
