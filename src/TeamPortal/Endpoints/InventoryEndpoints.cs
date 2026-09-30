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

    /// <summary>
    /// 物料**修改**权：管理员 + 部长。
    ///
    /// 归属部门移除后，"部长只能改本部门物料"的判定依据没了。改口为：物料是队内共享
    /// 资源，部长可以订正它的任何字段（名称/单价/编码/库位/等级/数量），也能在物料
    /// 布局页把物料挂到货位上——这些都是日常且可纠正的操作。
    /// </summary>
    internal static bool CanModifyItem(ClaimsPrincipal user)
        => user.FindFirstValue(ClaimTypes.Role) is "admin" or "部长";

    /// <summary>
    /// 物料**删除**权：仅管理员。
    ///
    /// 与修改分开是有意的：改错了还能再改回来，删了就没了（连带它的领用/盘点记录
    /// 都会失去关联）。所以把它单独留成管理员专属。
    /// </summary>
    internal static bool CanDeleteItem(ClaimsPrincipal user)
        => user.FindFirstValue(ClaimTypes.Role) == "admin";

    /// <summary>
    /// 导入文件必须位于 OS 临时目录或数据库所在目录内。
    /// POST /api/inventory/import 的 FilePath 是客户端可控的,直接交给 File.OpenRead
    /// 等于一个任意本地文件读取/探测原语;比较时带目录分隔符,避免 /data 匹配到 /data-evil。
    /// </summary>
    internal static bool IsImportPathAllowed(string filePath, AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return false;
        var full = Path.GetFullPath(filePath);
        var roots = new List<string> { Path.GetTempPath() };
        var dbPath = db.Database.GetDbConnection().DataSource;
        if (!string.IsNullOrWhiteSpace(dbPath) && dbPath != ":memory:")
        {
            var dbDir = Path.GetDirectoryName(Path.GetFullPath(dbPath));
            if (!string.IsNullOrEmpty(dbDir)) roots.Add(dbDir);
        }
        return roots.Any(root =>
        {
            var normRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return full.StartsWith(normRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        });
    }

    private static readonly string[] UnsafeNameFragments = ["<script", "<img", "onerror=", "javascript:"];
    private static bool HasUnsafeName(string name) =>
        UnsafeNameFragments.Any(f => name.Contains(f, StringComparison.OrdinalIgnoreCase));

    public static void MapInventoryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/inventory").RequireAuthorization();

        // 前端需要的库存规则（低库存阈值/提醒等级）与二维码短链的对外地址。
        //
        // 对外地址优先取管理员配置的 App:PublicBaseUrl；没配则用调用方传来的 origin
        // （浏览器实际访问的地址）。**绝不用 ctx.Request.Host** —— 后端收到的是
        // Next.js 服务端转发的请求，那是容器内网地址，曾生成出 http://backend:8080/i/...
        // 这种谁也扫不开的短链。
        group.MapGet("/meta", async (string? origin, InventoryService svc, SettingsService settings) =>
        {
            var baseUrl = await svc.ResolvePublicBaseUrlAsync(origin);
            return Results.Ok(new
            {
                lowStockThreshold = await svc.GetLowStockThresholdAsync(),
                lowStockGrade = await settings.Get("Inventory:LowStockGrade", "C"),
                publicBaseUrl = baseUrl,
                publicBaseLooksLocal = InventoryService.LooksNonPublic(baseUrl),
            });
        });

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

        // 按物料编码查（贴在实物上的二维码短链 /i/<编码> 与手输兜底都走这里；大小写不敏感）
        group.MapGet("/by-code/{code}", async (string code, InventoryService svc) =>
        {
            var item = await svc.GetByCode(code);
            return item is not null ? Results.Ok(item) : Results.Problem("没有找到这个编码对应的物料", statusCode: 404);
        });

        // 自动生号预览：前缀按分类、年份取采购年、序号取该池的下一个。
        // 物品号与型号必须由人给（系统无法从名称可靠推出），所以这里要求传全。
        group.MapGet("/next-code", async (string? category, string? itemNo, string? model, int? year, string? origin, InventoryService svc) =>
        {
            if (string.IsNullOrWhiteSpace(category))
                return Results.Problem("请先选择分类——编码前缀由分类决定（不选只能落到 XX「其他」）", statusCode: 400);
            if (string.IsNullOrWhiteSpace(itemNo) || string.IsNullOrWhiteSpace(model))
                return Results.Problem("请先填写物品号与型号，再生成编码", statusCode: 400);
            var code = await svc.NextCodeAsync(category, itemNo, model, year);
            var baseUrl = await svc.ResolvePublicBaseUrlAsync(origin);
            // 编码一生成，短链就一起给出来：填单人不用保存后再去列表里找。
            // baseUrl 为空（既没配对外地址、前端也没给 origin）时不给短链，避免编出一个错的。
            return Results.Ok(new
            {
                code,
                prefix = InventoryService.CategoryPrefix(category),
                shortUrl = string.IsNullOrEmpty(baseUrl) ? null : InventoryService.BuildShortUrl(baseUrl, code),
            });
        });

        // 服务端渲染的二维码（SVG）：浏览器之外的使用方（打印、导出、MCP）可直接取。
        // 必须能确定对外地址才给图——否则二维码里会是一个谁也扫不开的内网地址。
        group.MapGet("/by-code/{code}/qr.svg", async (string code, string? origin, InventoryService svc) =>
        {
            var baseUrl = await svc.ResolvePublicBaseUrlAsync(origin);
            if (string.IsNullOrEmpty(baseUrl))
                return Results.Problem("还没有配置「对外访问地址」，无法生成可扫的二维码。请到系统设置里填写后重试", statusCode: 409);
            var svg = InventoryService.BuildQrSvg(InventoryService.BuildShortUrl(baseUrl, code));
            return Results.Content(svg, "image/svg+xml");
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

            InventoryItem item;
            try
            {
                item = await svc.Create(req.Name, req.Category ?? "", req.Quantity,
                    req.Grade ?? "C", req.UnitPrice ?? 0, req.Code, req.LocationCode);
            }
            catch (InvalidOperationException ex)
            {
                // 编码撞车等业务校验失败 → 400，别让它冒成 500
                return Results.Problem(ex.Message, statusCode: 400);
            }
            log.Info("inventory", $"Part added: {item.Name} (qty {item.Quantity}) by {user.Identity?.Name}");
            log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "item", targetId: item.Id.ToString(),
                data: new { name = item.Name, quantity = item.Quantity, category = req.Category, grade = req.Grade, code = item.Code }, ipAddress: LogService.ClientIp(ctx));
            return Results.Created($"/api/inventory/{item.Id}", item);
        });

        group.MapPost("/import", async (ImportRequest req, ClaimsPrincipal user, InventoryService svc, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可导入零件", statusCode: 403);

            if (string.IsNullOrWhiteSpace(req.FilePath))
                return Results.Problem("FilePath is required", statusCode: 400);

            // FilePath 会被直接交给 File.OpenRead:必须限制在可信目录内,
            // 否则该接口等于一个任意本地文件读取/探测原语
            var importPath = Path.GetFullPath(req.FilePath);
            if (!IsImportPathAllowed(importPath, db))
                return Results.Problem("仅允许导入服务器临时目录或数据目录下的文件", statusCode: 400);
            if (!File.Exists(importPath))
                return Results.Problem("文件不存在", statusCode: 400);

            var count = await svc.ImportFromExcel(importPath);
            log.Info("inventory", $"Parts imported from {importPath}: {count} items by {user.Identity?.Name}");
            log.Audit("import", user.Identity?.Name ?? "unknown", targetType: "item",
                data: new { imported = count, filePath = importPath }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { imported = count });
        });

        group.MapPut("/{id:int}", async (int id, UpdateItemRequest req, InventoryService svc, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            if (!CanModifyItem(user)) return Results.Problem("仅管理员和部长可修改物料", statusCode: 403);

            var existing = await svc.GetById(id);
            if (existing is null) return Results.Problem("Not found", statusCode: 404);

            if (req.Quantity is < 0 || req.Quantity > 1_000_000)
                return Results.Problem(req.Quantity < 0 ? "数量不能为负数" : "数量超出合理范围(上限1000000)", statusCode: 400);
            if (req.UnitPrice is < 0)
                return Results.Problem("价格不能为负数", statusCode: 400);
            if (req.Name is not null && HasUnsafeName(req.Name))
                return Results.Problem("名称包含非法字符", statusCode: 400);

            InventoryItem? item;
            try
            {
                item = await svc.Update(id,
                    req.Name, req.Quantity, req.Status,
                    req.Grade, req.UnitPrice, req.Code, req.LocationCode, req.ClearCode);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
            if (item is not null)
            {
                var actor = user.Identity?.Name ?? "unknown";
                log.Info("inventory", $"Part updated: {item.Name} by {actor}");
                log.Audit("update", actor, targetType: "item", targetId: id.ToString(),
                    data: new { name = item.Name, grade = req.Grade, unitPrice = req.UnitPrice, code = item.Code, locationCode = req.LocationCode },
                    ipAddress: LogService.ClientIp(ctx));
                if (item.Quantity > 0 && item.Quantity <= 3)
                    notify.Notify("库存预警", $"零件「{item.Name}」库存仅剩 {item.Quantity} 件", "/inventory", targetRole: "staff", level: "warning");
            }
            return item is not null ? Results.Ok(item) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapDelete("/{id:int}", async (int id, InventoryService svc, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            if (!CanDeleteItem(user)) return Results.Problem("仅管理员可删除物料", statusCode: 403);

            var item = await svc.GetById(id);
            if (item is null) return Results.Problem("Not found", statusCode: 404);
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
            // 照片写进物料卡片，属于"改物料" → 与改/删同权，管理员专属
            if (!CanModifyItem(user)) return Results.Problem("仅管理员和部长可上传零件照片", statusCode: 403);

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
            if (InventoryService.IsLowStock(newQty, await svc.GetLowStockThresholdAsync()))
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
        group.MapPost("/{id:int}/consume", async (int id, TransactionRequest req, ClaimsPrincipal user, AppDbContext db, LogService log, NotificationService notify, InventoryService svc) =>
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
            if (InventoryService.IsLowStock(newQty, await svc.GetLowStockThresholdAsync()))
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
    string? Grade, decimal? UnitPrice, string? Code, string? LocationCode);
public record UpdateItemRequest(
    string? Name, int? Quantity, string? Status,
    string? Grade, decimal? UnitPrice, string? Code, string? LocationCode,
    // true 表示"明确清空编码"（与 null = 不改区分开）
    bool ClearCode = false);
public record ImportRequest(string FilePath);
public record TransactionRequest(int Quantity, string? Note);
