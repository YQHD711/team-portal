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
                log.Info("inventory", $"Checkout requested: item#{req.ItemId} x{req.Quantity} -> {result.Status} by {user.Identity?.Name}");
                log.Audit("checkout", user.Identity?.Name ?? "unknown", targetType: "material", targetId: result.Id.ToString(),
                    data: new { itemId = req.ItemId, quantity = req.Quantity, status = result.Status }, ipAddress: ip, userId: userId);
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
        group.MapPost("/checkout/{id:int}/approve-dept", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
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
                return Results.Ok(req);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // 管理员审批
        group.MapPost("/checkout/{id:int}/approve-admin", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsAdmin(role)) return Results.Problem("仅管理员可终审", statusCode: 403);
            try
            {
                var req = await svc.ApproveAdmin(id, userId!.Value);
                if (req is null) return Results.Problem("申请不存在或状态不正确（需为A级待管理员审批）", statusCode: 400);
                log.Info("inventory", $"Checkout #{id} admin-approved by {user.Identity?.Name}");
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
                data: new { reason = body.Reason }, ipAddress: LogService.ClientIp(ctx), userId: userId);
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
                log.Info("inventory", $"Checkin for checkout #{id} by {user.Identity?.Name} cond={body.Condition}");
                log.Audit("checkin", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                    data: new { condition = body.Condition, hasPhoto = body.HasPhoto, testNotes = body.TestNotes }, ipAddress: ip, userId: userId);
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
            log.Info("inventory", $"Stocktake started: {st.Type}/{st.Grade} by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: st.Id.ToString(),
                data: new { type = st.Type, grade = st.Grade, action = "start" }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Created($"/api/material/stocktake/{st.Id}", st);
        });

        group.MapGet("/stocktake", async (MaterialService svc) =>
        {
            return Results.Ok(await svc.GetStocktakes());
        });

        group.MapGet("/stocktake/{id:int}", async (int id, MaterialService svc) =>
        {
            var st = await svc.GetStocktake(id);
            return st is not null ? Results.Ok(st) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapPut("/stocktake/{id:int}/item/{itemId:int}", async (int id, int itemId, [FromBody] StocktakeItemReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var si = await svc.UpdateStocktakeItem(id, itemId, body.ActualQty, body.Note, userId!.Value);
            if (si is null) return Results.Problem("Not found", statusCode: 404);
            log.Info("inventory", $"Stocktake #{id} item#{itemId} checked: qty={body.ActualQty} by {user.Identity?.Name}");
            return Results.Ok(si);
        });

        // 分派
        group.MapPost("/stocktake/{id:int}/assign", async (int id, StocktakeAssignReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            await svc.AssignStocktakeItems(id, body.Items ?? new());
            log.Info("inventory", $"Stocktake #{id} assigned {body.Items?.Count ?? 0} items by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "assign", itemCount = body.Items?.Count ?? 0 }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = "已分派" });
        });

        // 自动均分
        group.MapPost("/stocktake/{id:int}/auto-assign", async (int id, StocktakeAutoAssignReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            if (body.UserIds is null || body.UserIds.Count == 0)
                return Results.Problem("请指定至少一名队员", statusCode: 400);
            await svc.AutoAssignStocktake(id, body.UserIds);
            log.Info("inventory", $"Stocktake #{id} auto-assigned to {body.UserIds.Count} members by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "auto-assign", memberCount = body.UserIds.Count }, ipAddress: LogService.ClientIp(ctx), userId: userId);
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
            await svc.BatchCheckStocktakeItems(id, userId.Value, body.Results);
            log.Info("inventory", $"Stocktake #{id} batch-checked {body.Results.Count} items by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "batch-check", itemCount = body.Results.Count }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { message = $"已提交 {body.Results.Count} 项盘点结果" });
        });

        group.MapPost("/stocktake/{id:int}/complete", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var st = await svc.CompleteStocktake(id);
            if (st is null) return Results.Problem("盘点不存在或已完成", statusCode: 400);
            log.Info("inventory", $"Stocktake #{id} completed by {user.Identity?.Name}");
            log.Audit("stocktake", user.Identity?.Name ?? "unknown", targetType: "material", targetId: id.ToString(),
                data: new { action = "complete" }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(st);
        });

        // ── 损坏报备 ──
        group.MapPost("/damage-report", async (DamageReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log, HttpContext ctx) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            var report = await svc.CreateDamageReport(body.ItemId, userId.Value,
                body.Type ?? "damage", body.Description ?? "", body.IsApprovedTest);
            log.Info("inventory", $"Damage report #{report.Id} created: item#{body.ItemId} type={body.Type ?? "damage"} by {user.Identity?.Name}");
            log.Audit("damage-report", user.Identity?.Name ?? "unknown", targetType: "material", targetId: report.Id.ToString(),
                data: new { itemId = body.ItemId, type = body.Type ?? "damage", isApprovedTest = body.IsApprovedTest }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Created($"/api/material/damage-report/{report.Id}", report);
        });

        group.MapGet("/damage-report", async (int? itemId, MaterialService svc) =>
        {
            return Results.Ok(await svc.GetDamageReports(itemId));
        });

        group.MapPut("/damage-report/{id:int}/resolve", async (int id, ResolveDamageReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
        {
            var (role, _, _, _) = await GetCtx(user, db);
            if (!IsAdmin(role)) return Results.Problem("仅管理员可定责", statusCode: 403);
            var report = await svc.ResolveDamageReport(id,
                body.Liability ?? "compensate", body.CompensationAmount, body.Resolution);
            if (report is null) return Results.Problem("Not found", statusCode: 404);
            log.Info("inventory", $"Damage report #{id} resolved: {body.Liability} by {user.Identity?.Name}");
            return Results.Ok(report);
        });
    }
}

public record CheckoutReq(int ItemId, int Quantity, string? Note);
public record CheckoutRejectReq(string? Reason);
public record CheckinReq(string? Condition, bool HasPhoto, string? TestNotes, string? PhotoUrl);
public record StocktakeStartReq(string? Type, string? Grade);
public record StocktakeItemReq(int? ActualQty, string? Note);
public record DamageReq(int ItemId, string? Type, string? Description, bool IsApprovedTest);
public record ResolveDamageReq(string? Liability, decimal? CompensationAmount, string? Resolution);
public record StocktakeAssignReq(Dictionary<int, int>? Items);
public record StocktakeAutoAssignReq(List<int>? UserIds);
public record StocktakeBatchCheckReq(List<StocktakeItemResult>? Results);
