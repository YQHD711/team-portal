using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class MaterialEndpoints
{
    private static int? GetUserId(ClaimsPrincipal u)
    {
        var id = u.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is not null ? int.Parse(id) : null;
    }

    private static async Task<(string? role, string? dept, int? deptId, int? userId)> GetCtx(ClaimsPrincipal u, AppDbContext db)
    {
        var idClaim = u.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null, null, null);
        var x = await db.Users.Include(usr => usr.Department).FirstOrDefaultAsync(usr => usr.Id == int.Parse(idClaim));
        return x is null ? (null, null, null, null) : (x.Role, x.Department?.Name, x.DepartmentId, x.Id);
    }

    private static bool IsStaff(string? r) => r == "admin" || r == "部长";
    private static bool IsAdmin(string? r) => r == "admin";

    /// <summary>盘点管理权:发起者 或 admin;其它部长/成员只读</summary>
    private static async Task<bool> IsStocktakeManagerAsync(AppDbContext db, int stocktakeId, string? role, int? userId)
        => role == "admin"
        || (role == "部长" && userId.HasValue
            && await db.Stocktakes.AnyAsync(s => s.Id == stocktakeId && s.CreatedByUserId == userId));

    /// <summary>审计 Data 可读化:按 itemId 反查零件名</summary>
    private static async Task<string?> ItemNameAsync(AppDbContext db, int itemId)
        => await db.InventoryItems.AsNoTracking().Where(i => i.Id == itemId).Select(i => i.Name).FirstOrDefaultAsync();

    private static async Task<Dictionary<int, string>> UserNamesByIdsAsync(AppDbContext db, IEnumerable<int> ids)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return new Dictionary<int, string>();
        return await db.Users.AsNoTracking().Where(u => list.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Username);
    }

    public static void MapMaterialEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/material").RequireAuthorization();

        // ── 领用申请 ──
        group.MapPost("/checkout", async (CheckoutReq req, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            var ip = LogService.ClientIp(ctx);
            if (InputSanitizer.HasUnsafeFragment(req.Note))
                return Results.Problem("包含非法字符", statusCode: 400);
            try
            {
                var (role, _, _, _) = await GetCtx(user, db);
                var result = await svc.CreateCheckout(req.ItemId, userId.Value, req.Quantity, req.Note ?? "", role);
                var itemName = await ItemNameAsync(db, req.ItemId);
                log.Info("inventory", $"Checkout requested: item#{req.ItemId} x{req.Quantity} -> {result.Status} by {user.Identity?.Name}");
                log.Audit("checkout", user.Identity?.Name ?? "unknown", targetType: "material", targetId: result.Id.ToString(),
                    data: new { item = itemName, itemId = req.ItemId, quantity = req.Quantity, status = result.Status }, ipAddress: ip, userId: userId);
                return Results.Created($"/api/material/checkout/{result.Id}", result);
            }
            catch (InvalidOperationException ex)
            {
                log.Warn("inventory", $"Checkout failed: item#{req.ItemId} x{req.Quantity} by {user.Identity?.Name}: {ex.Message}");
                log.Audit("checkout", user.Identity?.Name ?? "unknown", targetType: "material",
                    data: new { itemId = req.ItemId, quantity = req.Quantity, success = false, error = ex.Message }, ipAddress: ip, userId: userId);
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // 待审批列表
        group.MapGet("/checkout/pending", async (ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, deptId, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            var list = await svc.GetPendingRequests(role!, null, deptId);
            return Results.Ok(list);
        });

        // 部长审批
        group.MapPost("/checkout/{id:int}/approve-dept", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, deptId, userId) = await GetCtx(user, db);
            // 领用审批按申请人部门流转:仅该部门部长审批;管理员只走 /approve-admin
            if (role != "部长") return Results.Problem("仅本部门部长可审批", statusCode: 403);
            var detail = await svc.GetRequest(id);
            if (detail is null || detail.Requester?.DepartmentId != deptId)
                return Results.Problem("申请不存在或非本部门队员的领用", statusCode: 400);
            try
            {
                var req = await svc.ApproveDept(id, userId!.Value);
                if (req is null) return Results.Problem("申请不存在或状态不正确", statusCode: 400);
                log.Info("inventory", $"Checkout #{id} dept-approved by {user.Identity?.Name}");
                log.Audit("dept-approve", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                    data: new { item = detail.Item?.Name, requester = detail.Requester?.Username, quantity = detail.Quantity, grade = detail.Grade, status = req.Status }, ipAddress: LogService.ClientIp(ctx), userId: userId);
                return Results.Ok(req);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // 管理员审批
        group.MapPost("/checkout/{id:int}/approve-admin", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsAdmin(role)) return Results.Problem("仅管理员可终审", statusCode: 403);
            try
            {
                var req = await svc.ApproveAdmin(id, userId!.Value);
                if (req is null) return Results.Problem("申请不存在或状态不正确（需为待管理员审批）", statusCode: 400);
                var requesterName = await db.Users.AsNoTracking().Where(u => u.Id == req.RequesterUserId).Select(u => u.Username).FirstOrDefaultAsync();
                log.Info("inventory", $"Checkout #{id} admin-approved by {user.Identity?.Name}");
                log.Audit("admin-approve", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                    data: new { item = req.Item?.Name, requester = requesterName, quantity = req.Quantity, grade = req.Grade, status = req.Status }, ipAddress: LogService.ClientIp(ctx), userId: userId);
                return Results.Ok(req);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // 驳回
        group.MapPost("/checkout/{id:int}/reject", async (int id, CheckoutRejectReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, deptId, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可驳回", statusCode: 403);
            if (role == "部长")
            {
                var detail = await svc.GetRequest(id);
                if (detail is null || detail.Requester?.DepartmentId != deptId)
                    return Results.Problem("申请不存在或非本部门队员的领用", statusCode: 400);
            }
            var req = await svc.RejectRequest(id, userId!.Value, body.Reason ?? "未说明原因");
            if (req is null) return Results.Problem("无法驳回（状态不正确）", statusCode: 400);
            log.Warn("inventory", $"Checkout #{id} rejected by {user.Identity?.Name}: {body.Reason}");
            log.Audit("reject", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { item = req.Item?.Name, quantity = req.Quantity, reason = body.Reason }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(req);
        });

        // 我的领用记录
        group.MapGet("/checkout/my", async (ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.GetMyRequests(userId.Value));
        });

        // 领用详情
        group.MapGet("/checkout/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            var req = await svc.GetRequest(id);
            // 归属校验:管理员/部长可看全部(审批需要);普通成员仅可看自己的申请,其余一律 404 防枚举
            if (req is null || (!IsStaff(role) && req.RequesterUserId != userId))
                return Results.Problem("Not found", statusCode: 404);
            return Results.Ok(req);
        });

        // ── 归还 ──
        group.MapPost("/checkout/{id:int}/checkin", async (int id, CheckinReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var ip = LogService.ClientIp(ctx);
            try
            {
                var record = await svc.Checkin(id, userId!.Value,
                    body.Condition ?? "normal", body.HasPhoto,
                    body.TestNotes, body.PhotoUrl);
                if (record is null) return Results.Problem("领用申请不存在或已归还", statusCode: 400);
                var itemName = await db.CheckoutRequests.AsNoTracking().Where(r => r.Id == id).Select(r => r.Item!.Name).FirstOrDefaultAsync();
                log.Info("inventory", $"Checkin for checkout #{id} by {user.Identity?.Name} cond={body.Condition}");
                log.Audit("checkin", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                    data: new { item = itemName, condition = body.Condition, hasPhoto = body.HasPhoto, testNotes = body.TestNotes }, ipAddress: ip, userId: userId);
                return Results.Ok(record);
            }
            catch (InvalidOperationException ex)
            {
                log.Audit("checkin", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                    data: new { success = false, error = ex.Message }, ipAddress: ip, userId: userId);
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // ── 盘点 ──
        group.MapPost("/stocktake/start", async (StocktakeStartReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可发起盘点", statusCode: 403);
            var st = await svc.StartStocktake(body.Type ?? "weekly", body.Grade ?? "A", userId!.Value);
            log.Info("inventory", $"Stocktake started: {st.Type}/{st.Grade} ({st.Items.Count} 项) by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: st.Id.ToString(),
                data: new { type = st.Type, grade = st.Grade, action = "start", itemCount = st.Items.Count }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Created($"/api/material/stocktake/{st.Id}", st);
        });

        group.MapGet("/stocktake", async (ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            return Results.Ok(await svc.GetStocktakes());
        });

        group.MapGet("/stocktake/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            var st = await svc.GetStocktake(id);
            return st is not null ? Results.Ok(st) : Results.Problem("Not found", statusCode: 404);
        });

        // 发起者/admin:编辑单行实盘/备注(纠错,含替队员补全)
        group.MapPut("/stocktake/{id:int}/item/{itemId:int}", async (int id, int itemId, [FromBody] StocktakeItemReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var si = await svc.UpdateStocktakeItem(id, itemId, body.ActualQty, body.Note, userId!.Value);
            if (si is null) return Results.Problem("Not found", statusCode: 404);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "editItem", inventoryItemId = itemId, actualQty = body.ActualQty, note = body.Note }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(si);
        });

        // 分派(发起者/admin)
        group.MapPost("/stocktake/{id:int}/assign", async (int id, StocktakeAssignReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            await svc.AssignStocktakeItems(id, body.Items ?? new());
            var assignedNames = await UserNamesByIdsAsync(db, body.Items?.Values ?? Enumerable.Empty<int>());
            log.Info("inventory", $"Stocktake #{id} assigned {body.Items?.Count ?? 0} items by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "assign", itemCount = body.Items?.Count ?? 0, members = assignedNames.Values.Distinct().OrderBy(n => n, StringComparer.Ordinal).ToList() }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = "已分派" });
        });

        // 自动均分(发起者/admin)
        group.MapPost("/stocktake/{id:int}/auto-assign", async (int id, StocktakeAutoAssignReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            if (body.UserIds is null || body.UserIds.Count == 0)
                return Results.Problem("请指定至少一名队员", statusCode: 400);
            await svc.AutoAssignStocktake(id, body.UserIds);
            var autoCounts = await db.StocktakeItems
                .Where(si => si.StocktakeId == id && si.CheckedByUserId != null)
                .GroupBy(si => si.CheckedByUserId!.Value)
                .Select(g => new { UserId = g.Key, N = g.Count() })
                .ToListAsync();
            var autoNames = await UserNamesByIdsAsync(db, autoCounts.Select(c => c.UserId));
            log.Info("inventory", $"Stocktake #{id} auto-assigned to {body.UserIds.Count} members by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new
                {
                    action = "auto-assign", memberCount = body.UserIds.Count,
                    itemCount = autoCounts.Sum(c => c.N),
                    members = autoCounts.Select(c => $"{autoNames.GetValueOrDefault(c.UserId) ?? c.UserId.ToString()}×{c.N}").ToList()
                }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = "已自动分派" });
        });

        // 我的盘点任务
        group.MapGet("/stocktake/my-tasks", async (ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.GetMyStocktakeTasks(userId.Value));
        });

        // 批量提交盘点结果
        group.MapPost("/stocktake/{id:int}/batch-check", async (int id, StocktakeBatchCheckReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            if (body.Results is null || body.Results.Count == 0)
                return Results.Problem("请提交至少一项结果", statusCode: 400);
            try
            {
                await svc.BatchCheckStocktakeItems(id, userId.Value, body.Results);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
            var checkedItemIds = body.Results.Select(r => r.ItemId).ToList();
            var checkedNames = await db.InventoryItems.AsNoTracking().Where(i => checkedItemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
            var checkedItems = body.Results
                .Select(r => $"{checkedNames.GetValueOrDefault(r.ItemId) ?? r.ItemId.ToString()} → {r.ActualQty}{(string.IsNullOrWhiteSpace(r.Note) ? "" : $" ({r.Note})")}")
                .Take(20).ToList();
            log.Info("inventory", $"Stocktake #{id} batch-checked {body.Results.Count} items by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "batch-check", itemCount = body.Results.Count, items = checkedItems }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = $"已提交 {body.Results.Count} 项盘点结果" });
        });

        // ── 发起者/admin 全权(编辑/暂停/取消/删除/两步合并) ──

        // 完成盘点(第一步:冻结结果,pending_merge)
        group.MapPost("/stocktake/{id:int}/finalize", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            try
            {
                var st = await svc.FinalizeStocktake(id);
                if (st is null) return Results.Problem("盘点不存在或状态不正确", statusCode: 400);
                log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                    data: new { action = "finalize", diffCount = st.Items.Count(x => x.Difference != 0) }, ipAddress: LogService.ClientIp(ctx), userId: userId);
                return Results.Ok(st);
            }
            catch (InvalidOperationException ex) { return Results.Problem(ex.Message, statusCode: 400); }
        });

        // 合并入库(第二步:差异统一写回,completed)
        group.MapPost("/stocktake/{id:int}/merge", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var st = await svc.MergeStocktake(id);
            if (st is null) return Results.Problem("盘点不存在或状态不正确", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "merge", diffCount = st.Items.Count(x => x.Difference != 0) }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(st);
        });

        group.MapPost("/stocktake/{id:int}/pause", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var st = await svc.PauseStocktake(id);
            if (st is null) return Results.Problem("盘点不存在或不可暂停", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "pause" }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(st);
        });
        group.MapPost("/stocktake/{id:int}/resume", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var st = await svc.ResumeStocktake(id);
            if (st is null) return Results.Problem("盘点不存在或不可恢复", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "resume" }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(st);
        });
        group.MapPost("/stocktake/{id:int}/cancel", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var st = await svc.CancelStocktake(id);
            if (st is null) return Results.Problem("盘点不存在或不可取消", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "cancel" }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(st);
        });
        group.MapDelete("/stocktake/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var ok = await svc.DeleteStocktake(id);
            if (!ok) return Results.Problem("盘点不存在或已合并不可删除", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "delete" }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = "已删除" });
        });

        // 编辑盘面:增/删项、改派(仅未合并)
        group.MapPost("/stocktake/{id:int}/items", async (int id, StocktakeAddItemReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var si = await svc.AddStocktakeItem(id, body.InventoryItemId);
            if (si is null) return Results.Problem("零件不存在/等级不符/已包含/盘点不可再改", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "addItem", inventoryItemId = body.InventoryItemId }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(si);
        });
        group.MapDelete("/stocktake/{id:int}/items/{inventoryItemId:int}", async (int id, int inventoryItemId, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var ok = await svc.RemoveStocktakeItem(id, inventoryItemId);
            if (!ok) return Results.Problem("盘点不存在/该项不存在/不可移除", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "removeItem", inventoryItemId }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = "已移除" });
        });
        group.MapPost("/stocktake/{id:int}/items/{inventoryItemId:int}/assign", async (int id, int inventoryItemId, StocktakeAssignItemReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!await IsStocktakeManagerAsync(db, id, role, userId)) return Results.Problem("仅发起者或管理员可操作", statusCode: 403);
            var si = await svc.ReassignStocktakeItem(id, inventoryItemId, body.UserId);
            if (si is null) return Results.Problem("盘点不存在/该项不存在/不可改派", statusCode: 400);
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "assignItem", inventoryItemId, checkedByUserId = body.UserId }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(si);
        });

        // ── 损坏报备 ──
        group.MapPost("/damage-report", async (DamageReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            var report = await svc.CreateDamageReport(body.ItemId, userId.Value,
                body.Type ?? "damage", body.Description ?? "", body.IsApprovedTest);
            var itemName = await ItemNameAsync(db, body.ItemId);
            log.Info("inventory", $"Damage report #{report.Id} created: item#{body.ItemId} type={body.Type ?? "damage"} by {user.Identity?.Name}");
            log.Audit("damage-report", user.Identity?.Name ?? "unknown", targetType: "material", targetId: report.Id.ToString(),
                data: new { item = itemName, itemId = body.ItemId, type = body.Type ?? "damage", isApprovedTest = body.IsApprovedTest }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Created($"/api/material/damage-report/{report.Id}", report);
        });

        group.MapGet("/damage-report", async (int? itemId, MaterialService svc) =>
        {
            return Results.Ok(await svc.GetDamageReports(itemId));
        });

        group.MapPut("/damage-report/{id:int}/resolve", async (int id, ResolveDamageReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsAdmin(role)) return Results.Problem("仅管理员可定责", statusCode: 403);
            var report = await svc.ResolveDamageReport(id,
                body.Liability ?? "compensate", body.CompensationAmount, body.Resolution);
            if (report is null) return Results.Problem("Not found", statusCode: 404);
            log.Audit("damage-report", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "resolve", itemId = report.Item?.Id, liability = body.Liability }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(report);
        });
    }
}

public record CheckoutReq(int ItemId, int Quantity, string? Note);
public record CheckoutRejectReq(string? Reason);
public record CheckinReq(string? Condition, bool HasPhoto, string? TestNotes, string? PhotoUrl);
public record StocktakeStartReq(string? Type, string? Grade);
public record StocktakeItemReq(int? ActualQty, string? Note);
public record StocktakeAddItemReq(int InventoryItemId);
public record StocktakeAssignItemReq(int? UserId);
public record DamageReq(int ItemId, string? Type, string? Description, bool IsApprovedTest);
public record ResolveDamageReq(string? Liability, decimal? CompensationAmount, string? Resolution);
public record StocktakeAssignReq(Dictionary<int, int>? Items);
public record StocktakeAutoAssignReq(List<int>? UserIds);
public record StocktakeBatchCheckReq(List<StocktakeItemResult>? Results);
