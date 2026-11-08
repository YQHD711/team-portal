using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 设备端电池借还：认证 = 设备凭据（X-Device-Key/Secret）+ 设备内用户会话（X-Device-Session）。
/// 借用人取自会话登录的用户，因此**不依赖用户 JWT**。
///
/// 使用流程：设备登录 POST /api/device/login → 拿 sessionToken → 扫电池码调用这里的借还。
/// </summary>
public static class DeviceBatteryEndpoints
{
    private static IResult Unauthorized() => Results.Problem("设备认证失败", statusCode: 401);
    private static IResult NoSession() =>
        Results.Problem("设备未登录用户或会话已过期，请先在设备上登录", statusCode: 401);

    public static void MapDeviceBatteryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/device/battery");

        // 统一认证：设备凭据 + 设备内用户会话
        async Task<(Device? Device, DeviceSession? Session, IResult? Error)> AuthAsync(
            HttpContext ctx, DeviceAuthService auth)
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return (null, null, Unauthorized());
            var session = await auth.AuthenticateSessionAsync(ctx, device);
            if (session is null) return (device, null, NoSession());
            return (device, session, null);
        }

        // 当前会话用户的在借电池
        group.MapGet("/mine", async (HttpContext ctx, DeviceAuthService auth, BatteryService svc) =>
        {
            var (_, session, error) = await AuthAsync(ctx, auth);
            if (error is not null) return error;
            return Results.Ok(await svc.GetMineAsync(session!.UserId));
        });

        // 按编码查询（扫码后先看状态）
        group.MapGet("/{code}", async (string code, HttpContext ctx, DeviceAuthService auth, AppDbContext db) =>
        {
            var (_, _, error) = await AuthAsync(ctx, auth);
            if (error is not null) return error;

            var item = await db.BatteryItems.Include(b => b.CurrentBorrower)
                .FirstOrDefaultAsync(b => b.Code == code.ToUpperInvariant());
            if (item is null) return Results.Problem("没有找到这个编码对应的电池", statusCode: 404);
            return Results.Ok(new
            {
                item.Id, item.Code, item.Model, item.Status, item.Health,
                borrower = item.CurrentBorrower?.Username,
                borrowedAt = item.BorrowedAt,
            });
        });

        // 借出：借用人 = 当前设备会话登录的用户
        group.MapPost("/{code}/borrow", async (string code, HttpContext ctx, DeviceAuthService auth,
            BatteryService svc, AppDbContext db, LogService log) =>
        {
            var (device, session, error) = await AuthAsync(ctx, auth);
            if (error is not null) return error;

            var item = await db.BatteryItems.FirstOrDefaultAsync(b => b.Code == code.ToUpperInvariant());
            if (item is null) return Results.Problem("没有找到这个编码对应的电池", statusCode: 404);
            try
            {
                var loan = await svc.BorrowAsync(item.Id, session!.UserId, null);
                log.Audit("device-borrow", $"device:{device!.DeviceKey}", targetType: "battery",
                    targetId: item.Id.ToString(),
                    data: new { item.Code, borrowerId = session.UserId, loanId = loan.Id },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(new
                {
                    loanId = loan.Id, batteryId = item.Id, code = item.Code,
                    borrowerId = session.UserId, borrowedAt = loan.BorrowedAt,
                });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 409);
            }
        });

        // 归还：操作人 = 当前设备会话登录的用户
        group.MapPost("/{code}/return", async (string code, HttpContext ctx, DeviceAuthService auth,
            BatteryService svc, AppDbContext db, LogService log) =>
        {
            var (device, session, error) = await AuthAsync(ctx, auth);
            if (error is not null) return error;

            var item = await db.BatteryItems.FirstOrDefaultAsync(b => b.Code == code.ToUpperInvariant());
            if (item is null) return Results.Problem("没有找到这个编码对应的电池", statusCode: 404);
            try
            {
                var loan = await svc.ReturnAsync(item.Id, session!.UserId, null);
                log.Audit("device-return", $"device:{device!.DeviceKey}", targetType: "battery",
                    targetId: item.Id.ToString(),
                    data: new { item.Code, operatorId = session.UserId, loanId = loan.Id },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(new
                {
                    loanId = loan.Id, batteryId = item.Id, code = item.Code,
                    returnedAt = loan.ReturnedAt,
                });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 409);
            }
        });
    }
}
