using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 设备接入端点（ESP32 / 传感器网关）。
///
/// 认证不走用户 JWT，而是每个请求带 X-Device-Key + X-Device-Secret，
/// 由 <see cref="DeviceAuthService.AuthenticateAsync"/> 校验；因此这里不用
/// RequireAuthorization，而是每个端点自己做认证，认证失败统一 401。
/// </summary>
public static class DeviceEndpoints
{
    private const int MaxPayloadChars = 20000;

    private static IResult Unauthorized() => Results.Problem("设备认证失败", statusCode: 401);

    public static void MapDeviceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/device");

        // 心跳：设备上线自检，顺带拿到自己的元信息与服务端时间
        group.MapGet("/ping", async (HttpContext ctx, DeviceAuthService auth) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();
            return Results.Ok(new
            {
                deviceId = device.Id,
                name = device.Name,
                type = device.Type,
                locationCode = device.LocationCode,
                serverTime = DateTime.UtcNow,
            });
        });

        // 设备上登录：用设备凭据换取「设备内用户会话」，不复用用户 JWT。
        // 设备借还（/api/device/battery/*）携带 X-Device-Session 即代表登录用户。
        group.MapPost("/login", async (DeviceLoginRequest req, HttpContext ctx, DeviceAuthService auth,
            AuthService users, LogService log) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("用户名和密码必填", statusCode: 400);

            User? user;
            try
            {
                user = await users.VerifyCredentials(req.Username.Trim(), req.Password);
            }
            catch (InvalidOperationException ex)
            {
                // 账号锁定：与网页登录同一套策略，返回 429
                return Results.Problem(ex.Message, statusCode: 429);
            }
            if (user is null)
            {
                log.Audit("device-login", $"device:{device.DeviceKey}", targetType: "device",
                    targetId: device.Id.ToString(),
                    data: new { username = req.Username, success = false },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Problem("用户名或密码错误", statusCode: 401);
            }

            var (session, token) = await auth.CreateSessionAsync(device, user, ctx);
            log.Audit("device-login", $"device:{device.DeviceKey}", targetType: "user",
                targetId: user.Id.ToString(),
                data: new { username = user.Username, sessionId = session.Id, expiresAt = session.ExpiresAt },
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new
            {
                sessionToken = token,
                expiresAt = session.ExpiresAt,
                user = new { user.Id, user.Username, user.Role },
            });
        });

        group.MapPost("/logout", async (HttpContext ctx, DeviceAuthService auth, LogService log) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();
            var revoked = await auth.RevokeSessionAsync(ctx, device);
            log.Audit("device-logout", $"device:{device.DeviceKey}", targetType: "device",
                targetId: device.Id.ToString(), data: new { revoked }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { revoked });
        });

        // 遥测上报：payload 原样落库，先保证"能收、能回放"
        group.MapPost("/telemetry", async (TelemetryRequest req, HttpContext ctx,
            DeviceAuthService auth, AppDbContext db) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();

            var payload = req.Payload?.GetRawText() ?? "{}";
            if (payload.Length > MaxPayloadChars)
                return Results.Problem($"payload 超过 {MaxPayloadChars} 字符", statusCode: 400);

            var kind = string.IsNullOrWhiteSpace(req.Kind) ? "telemetry" : req.Kind.Trim();
            if (kind.Length > 32) kind = kind[..32];

            var row = new DeviceTelemetry { DeviceId = device.Id, Kind = kind, PayloadJson = payload };
            db.DeviceTelemetries.Add(row);
            await db.SaveChangesAsync();
            return Results.Created($"/api/device/telemetry/{row.Id}",
                new { id = row.Id, createdAt = row.CreatedAt });
        });

        // 设备扫码/读卡后按编码查物料
        group.MapGet("/materials/{code}", async (string code, HttpContext ctx,
            DeviceAuthService auth, InventoryService items) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();

            var item = await items.GetByCode(code);
            if (item is null) return Results.Problem("没有找到这个编码对应的物料", statusCode: 404);
            return Results.Ok(new
            {
                item.Id, item.Name, item.Category, item.Code,
                item.Quantity, item.LocationCode, item.Status,
            });
        });

        // 设备上报库存变动（入库/出库），同一物料行原子更新并留流水与审计
        group.MapPost("/materials/{code}/stock", async (string code, StockDeltaRequest req,
            HttpContext ctx, DeviceAuthService auth, AppDbContext db, LogService log) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();
            if (req.Delta == 0) return Results.Problem("Delta 不能为 0", statusCode: 400);

            var found = await db.InventoryItems
                .FirstOrDefaultAsync(i => i.Code != null && i.Code == code.ToUpperInvariant());
            if (found is null) return Results.Problem("没有找到这个编码对应的物料", statusCode: 404);

            var newQty = found.Quantity + req.Delta;
            if (newQty < 0)
                return Results.Problem($"库存不足：当前 {found.Quantity}，变更 {req.Delta}", statusCode: 400);

            found.Quantity = newQty;
            found.UpdatedAt = DateTime.UtcNow;
            db.InventoryTransactions.Add(new InventoryTransaction
            {
                InventoryItemId = found.Id,
                Type = req.Delta > 0 ? "device_in" : "device_out",
                Quantity = Math.Abs(req.Delta),
                UserName = $"device:{device.DeviceKey}",
                Note = req.Note,
            });
            await db.SaveChangesAsync();

            log.Audit(req.Delta > 0 ? "device-stock-in" : "device-stock-out",
                $"device:{device.DeviceKey}", targetType: "item", targetId: found.Id.ToString(),
                data: new { item = found.Name, code = found.Code, delta = req.Delta, quantity = newQty, deviceId = device.Id },
                ipAddress: LogService.ClientIp(ctx));

            return Results.Ok(new { found.Id, found.Quantity, delta = req.Delta });
        });
    }
}

/// <summary>遥测上报体：Payload 原样保存，不做结构约束。</summary>
public record TelemetryRequest(string? Kind, JsonElement? Payload);

/// <summary>库存变动上报体：Delta 正数入库、负数出库。</summary>
public record StockDeltaRequest(int Delta, string? Note);

/// <summary>设备内用户登录体：设备凭据已在请求头，这里只带用户账号密码。</summary>
public record DeviceLoginRequest(string Username, string Password);
