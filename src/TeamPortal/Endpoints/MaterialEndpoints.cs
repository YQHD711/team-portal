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
        group.MapPost("/checkout", async (CheckoutReq req, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            try
            {
                var result = await svc.CreateCheckout(req.ItemId, userId.Value, req.Quantity, req.Note ?? "");
                return Results.Created($"/api/material/checkout/{result.Id}", result);
            }
            catch (InvalidOperationException ex)
            {
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
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可审批", statusCode: 403);
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
        group.MapPost("/checkout/{id:int}/reject", async (int id, CheckoutRejectReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可驳回", statusCode: 403);
            var req = await svc.RejectRequest(id, userId!.Value, body.Reason ?? "未说明原因");
            if (req is null) return Results.Problem("无法驳回（状态不正确）", statusCode: 400);
            log.Warn("inventory", $"Checkout #{id} rejected by {user.Identity?.Name}: {body.Reason}");
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
        group.MapGet("/checkout/{id:int}", async (int id, MaterialService svc) =>
        {
            var req = await svc.GetRequest(id);
            return req is not null ? Results.Ok(req) : Results.Problem("Not found", statusCode: 404);
        });

        // ── 归还 ──
        group.MapPost("/checkout/{id:int}/checkin", async (int id, CheckinReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            try
            {
                var record = await svc.Checkin(id, userId!.Value,
                    body.Condition ?? "normal", body.HasPhoto,
                    body.TestNotes, body.PhotoUrl);
                if (record is null) return Results.Problem("领用申请不存在或已归还", statusCode: 400);
                log.Info("inventory", $"Checkin for checkout #{id} by {user.Identity?.Name} cond={body.Condition}");
                return Results.Ok(record);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // ── 盘点 ──
        group.MapPost("/stocktake/start", async (StocktakeStartReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可发起盘点", statusCode: 403);
            var st = await svc.StartStocktake(body.Type ?? "weekly", body.Grade ?? "A", userId!.Value);
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

        group.MapPut("/stocktake/{id:int}/item/{itemId:int}", async (int id, int itemId, StocktakeItemReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, userId) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var si = await svc.UpdateStocktakeItem(id, itemId, body.ActualQty, body.Note, userId!.Value);
            return si is not null ? Results.Ok(si) : Results.Problem("Not found", statusCode: 404);
        });

        // 分派
        group.MapPost("/stocktake/{id:int}/assign", async (int id, StocktakeAssignReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            await svc.AssignStocktakeItems(id, body.Items ?? new());
            return Results.Ok(new { message = "已分派" });
        });

        // 自动均分
        group.MapPost("/stocktake/{id:int}/auto-assign", async (int id, StocktakeAutoAssignReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (role, _, _, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            if (body.UserIds is null || body.UserIds.Count == 0)
                return Results.Problem("请指定至少一名队员", statusCode: 400);
            await svc.AutoAssignStocktake(id, body.UserIds);
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
        group.MapPost("/stocktake/{id:int}/batch-check", async (int id, StocktakeBatchCheckReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            if (body.Results is null || body.Results.Count == 0)
                return Results.Problem("请提交至少一项结果", statusCode: 400);
            await svc.BatchCheckStocktakeItems(id, userId.Value, body.Results);
            return Results.Ok(new { message = $"已提交 {body.Results.Count} 项盘点结果" });
        });

        group.MapPost("/stocktake/{id:int}/complete", async (int id, ClaimsPrincipal user, AppDbContext db, MaterialService svc, LogService log) =>
        {
            var (role, _, _, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var st = await svc.CompleteStocktake(id);
            if (st is null) return Results.Problem("盘点不存在或已完成", statusCode: 400);
            log.Info("inventory", $"Stocktake #{id} completed by {user.Identity?.Name}");
            return Results.Ok(st);
        });

        // ── 损坏报备 ──
        group.MapPost("/damage-report", async (DamageReq body, ClaimsPrincipal user, AppDbContext db, MaterialService svc) =>
        {
            var (_, _, _, userId) = await GetCtx(user, db);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            var report = await svc.CreateDamageReport(body.ItemId, userId.Value,
                body.Type ?? "damage", body.Description ?? "", body.IsApprovedTest);
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
