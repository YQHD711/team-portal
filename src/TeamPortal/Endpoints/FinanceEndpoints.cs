using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class FinanceEndpoints
{
    private static int? GetUserId(ClaimsPrincipal u)
    {
        var id = u.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is not null ? int.Parse(id) : null;
    }

    private static async Task<(string? role, string? dept)> GetCtx(ClaimsPrincipal u, AppDbContext db)
    {
        var id = u.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null) return (null, null);
        var x = await db.Users.Include(usr => usr.Department).FirstOrDefaultAsync(usr => usr.Id == int.Parse(id));
        return x is null ? (null, null) : (x.Role, x.Department?.Name);
    }

    private static bool IsStaff(string? r) => r == "admin" || r == "部长";
    private static bool IsAdmin(string? r) => r == "admin";

    public static void MapFinanceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/finance").RequireAuthorization();

        // ── Stats ──
        group.MapGet("/stats", async (FinanceService svc) => Results.Ok(await svc.GetStats()));

        // ── Purchase Requests ──
        group.MapGet("/requests", async (string? status, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var userId = GetUserId(user);
            return Results.Ok(await svc.GetRequests(status, userId));
        });

        group.MapGet("/requests/all", async (string? status, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看全部", statusCode: 403);
            return Results.Ok(await svc.GetRequests(status, null));
        });

        group.MapGet("/requests/{id:int}", async (int id, FinanceService svc) =>
        {
            var r = await svc.GetRequest(id);
            return r is not null ? Results.Ok(r) : Results.Problem("Not found", statusCode: 404);
        });

        group.MapPost("/requests", async (CreatePurchaseReq req, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可申请", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.ItemName)) return Results.Problem("物品名称不能为空", statusCode: 400);
            var r = await svc.CreateRequest(userId.Value, req.ItemName, req.Quantity, req.EstimatedPrice, req.Reason);
            return Results.Created($"/api/finance/requests/{r.Id}", r);
        });

        group.MapPost("/requests/{id:int}/approve", async (int id, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsAdmin(role)) return Results.Problem("仅管理员可审批", statusCode: 403);
            var userId = GetUserId(user) ?? 0;
            var ok = await svc.Approve(id, userId);
            return ok ? Results.Ok(new { message = "已批准" }) : Results.Problem("审批失败（状态不是待审批）", statusCode: 400);
        });

        group.MapPost("/requests/{id:int}/reject", async (int id, RejectReq req, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsAdmin(role)) return Results.Problem("仅管理员可审批", statusCode: 403);
            var userId = GetUserId(user) ?? 0;
            var ok = await svc.Reject(id, userId, req.Reason ?? "未说明原因");
            return ok ? Results.Ok(new { message = "已拒绝" }) : Results.Problem("操作失败", statusCode: 400);
        });

        group.MapPost("/requests/{id:int}/purchase", async (int id, PurchaseReq req, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var ok = await svc.MarkPurchased(id, req.ActualPrice);
            return ok ? Results.Ok(new { message = "已标记为已购买" }) : Results.Problem("操作失败", statusCode: 400);
        });

        group.MapPost("/requests/{id:int}/receive", async (int id, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
            var ok = await svc.MarkReceived(id);
            return ok ? Results.Ok(new { message = "已入库" }) : Results.Problem("操作失败（状态不是已购买）", statusCode: 400);
        });

        // ── Reports (admin only) ──
        group.MapGet("/report/monthly", async (int? year, int? month, ClaimsPrincipal user, AppDbContext db, FinanceService svc) =>
        {
            var (role, _) = await GetCtx(user, db);
            if (role != "admin") return Results.Problem("仅管理员可查看月度报表", statusCode: 403);
            var y = year ?? DateTime.UtcNow.Year;
            var m = month ?? DateTime.UtcNow.Month;
            return Results.Ok(await svc.GetMonthlyReport(y, m));
        });

    }
}

public record CreatePurchaseReq(string ItemName, int Quantity, decimal EstimatedPrice, string Reason);
public record RejectReq(string? Reason);
public record PurchaseReq(decimal ActualPrice);
