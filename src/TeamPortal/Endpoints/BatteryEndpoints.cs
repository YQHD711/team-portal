using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 电池台账与借还端点。
///
/// 权限约定：
/// - 查询/自助借还：任何登录用户；
/// - 新增/编辑电池、代借/代还：admin + 部长；
/// - 借还免审批，但"替别人借"必须 staff，避免普通成员随便把责任挂到别人头上。
/// </summary>
public static class BatteryEndpoints
{
    private static bool IsStaff(ClaimsPrincipal u)
        => u.FindFirstValue(ClaimTypes.Role) is "admin" or "部长";

    private static bool IsAdmin(ClaimsPrincipal u)
        => u.FindFirstValue(ClaimTypes.Role) is "admin";

    /// <summary>危险 HTML/脚本片段拦截（与物料接口同源），电池字段与物料一样不应接受脚本片段。</summary>
    private static bool HasUnsafe(params string?[] fields)
        => fields.Any(InputSanitizer.HasUnsafeFragment);

    private static int? GetUserId(ClaimsPrincipal u)
        => int.TryParse(u.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    public static void MapBatteryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/battery").RequireAuthorization();

        // 台账列表（状态/关键字筛选）
        group.MapGet("/", async (string? status, string? search, BatteryService svc) =>
            Results.Ok(await svc.GetAllAsync(status, search)));

        // 新增电池时的下一个码预览
        group.MapGet("/next-code", async (BatteryService svc) =>
            Results.Ok(new { code = await svc.NextCodeAsync() }));

        // 扫码查询（大小写不敏感）
        group.MapGet("/by-code/{code}", async (string code, BatteryService svc) =>
        {
            var item = await svc.GetByCodeAsync(code);
            return item is null
                ? Results.Problem("没有找到这个编码对应的电池", statusCode: 404)
                : Results.Ok(item);
        });

        group.MapGet("/{id:int}", async (int id, BatteryService svc) =>
        {
            var item = await svc.GetByIdAsync(id);
            return item is null ? Results.Problem("电池不存在", statusCode: 404) : Results.Ok(item);
        });

        // ── 新增 ──
        group.MapPost("/", async (CreateBatteryRequest req, ClaimsPrincipal user, BatteryService svc,
            LogService log, HttpContext ctx) =>
        {
            if (!IsStaff(user)) return Results.Problem("仅管理员和部长可新增电池", statusCode: 403);
            if (HasUnsafe(req.Code, req.Model, req.Notes))
                return Results.Problem("字段包含非法字符", statusCode: 400);
            try
            {
                var item = await svc.CreateAsync(req.Code, req.Model, req.Health, req.Notes);
                log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "battery",
                    targetId: item.Id.ToString(), data: new { item.Code, item.Model, item.Health },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Created($"/api/battery/{item.Id}", item);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // ── 编辑 ──
        group.MapPut("/{id:int}", async (int id, UpdateBatteryRequest req, ClaimsPrincipal user,
            BatteryService svc, LogService log, HttpContext ctx) =>
        {
            if (!IsStaff(user)) return Results.Problem("仅管理员和部长可编辑电池", statusCode: 403);
            if (HasUnsafe(req.Model, req.Notes))
                return Results.Problem("字段包含非法字符", statusCode: 400);
            try
            {
                var item = await svc.UpdateAsync(id, req.Model, req.Status, req.Health, req.Notes, req.ClearModel);
                if (item is null) return Results.Problem("电池不存在", statusCode: 404);
                log.Audit("update", user.Identity?.Name ?? "unknown", targetType: "battery",
                    targetId: id.ToString(), data: new { item.Status, item.Model, item.Health },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(item);
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // ── 删除（仅管理员；在借/有未归还流水时拒绝）──
        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, BatteryService svc,
            LogService log, HttpContext ctx) =>
        {
            if (!IsAdmin(user)) return Results.Problem("仅管理员可删除电池", statusCode: 403);
            try
            {
                var ok = await svc.DeleteAsync(id);
                if (!ok) return Results.Problem("电池不存在", statusCode: 404);
                log.Audit("delete", user.Identity?.Name ?? "unknown", targetType: "battery",
                    targetId: id.ToString(), ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(new { success = true });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 409);
            }
        });

        // ── 借出（body.UserId 存在 = 代借，仅 staff）──
        group.MapPost("/{id:int}/borrow", async (int id, BorrowBatteryRequest req, ClaimsPrincipal user,
            BatteryService svc, LogService log, HttpContext ctx) =>
        {
            var operatorId = GetUserId(user);
            if (operatorId is null) return Results.Problem("未登录", statusCode: 401);
            var borrowerId = req.UserId ?? operatorId.Value;
            if (borrowerId != operatorId.Value && !IsStaff(user))
                return Results.Problem("只能为自己借出电池", statusCode: 403);
            try
            {
                var loan = await svc.BorrowAsync(id, borrowerId, req.Note);
                log.Audit("borrow", user.Identity?.Name ?? "unknown", targetType: "battery",
                    targetId: id.ToString(),
                    data: new { loanId = loan.Id, borrowerId, note = req.Note },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(new { loanId = loan.Id, batteryId = id, borrowerId, borrowedAt = loan.BorrowedAt });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 409);
            }
        });

        // ── 归还（登录用户即可；代还时 ReturnedBy 记录操作人）──
        group.MapPost("/{id:int}/return", async (int id, ReturnBatteryRequest req, ClaimsPrincipal user,
            BatteryService svc, LogService log, HttpContext ctx) =>
        {
            var operatorId = GetUserId(user);
            if (operatorId is null) return Results.Problem("未登录", statusCode: 401);
            try
            {
                var loan = await svc.ReturnAsync(id, operatorId.Value, req.Note);
                log.Audit("return", user.Identity?.Name ?? "unknown", targetType: "battery",
                    targetId: id.ToString(),
                    data: new { loanId = loan.Id, returnedAt = loan.ReturnedAt, note = req.Note },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(new { loanId = loan.Id, batteryId = id, returnedAt = loan.ReturnedAt });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 409);
            }
        });

        // ── 流水 ──
        group.MapGet("/loans", async (int? batteryId, int? userId, bool? activeOnly, int? take,
            BatteryService svc) =>
            Results.Ok(await svc.GetLoansAsync(batteryId, userId, activeOnly ?? false, take ?? 100)));

        // ── 我的在借 ──
        group.MapGet("/mine", async (ClaimsPrincipal user, BatteryService svc) =>
        {
            var userId = GetUserId(user);
            return userId is null
                ? Results.Problem("未登录", statusCode: 401)
                : Results.Ok(await svc.GetMineAsync(userId.Value));
        });

        // ── 超时未还 ──
        group.MapGet("/overdue", async (int? hours, BatteryService svc) =>
        {
            var h = hours ?? await svc.GetOverdueHoursAsync();
            return Results.Ok(await svc.GetOverdueAsync(Math.Clamp(h, 1, 24 * 30)));
        });
    }
}

public record CreateBatteryRequest(string? Code, string? Model, string? Health, string? Notes);
public record UpdateBatteryRequest(string? Model, string? Status, string? Health, string? Notes, bool ClearModel = false);
public record BorrowBatteryRequest(int? UserId, string? Note);
public record ReturnBatteryRequest(string? Note);
