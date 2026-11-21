using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services.Permissions;
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

    /// <summary>从身份码内容提取 slug：支持完整短链 /u/{slug}、纯 slug、以及纯学号（原样返回）。</summary>
    private static string ExtractSlug(string identifier)
    {
        if (!identifier.Contains('/')) return identifier;
        var parts = identifier.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var idx = Array.IndexOf(parts, "u");
        return idx >= 0 && idx + 1 < parts.Length ? parts[idx + 1] : identifier;
    }

    public static void MapDeviceEndpoints(this WebApplication app)
    {
        // 设备端点只靠 X-Device-Key/Secret 认证，被拿到凭据或被滥用时会直接打数据库；
        // 统一套用 Program.cs 里的 "default" 限流策略，防止单 IP 高频刷设备接口。
        var group = app.MapGroup("/api/device").RequireRateLimiting("default");

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

            var (session, token) = await auth.CreateSessionAsync(device, user, ctx, method: "password");
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

        // 设备终端现场认人（扫身份码 / 输入学号）：免密、快，责任记到识别出的用户。
        // 信任模型 = 设备凭据（柜边终端）+ 身份标识；与密码登录并存，审计区分标记 noauth。
        group.MapPost("/login-by-id", async (DeviceLoginByIdRequest req, HttpContext ctx, DeviceAuthService auth,
            AppDbContext db, LogService log) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();
            var identifier = req.Identifier?.Trim();
            if (string.IsNullOrWhiteSpace(identifier) || identifier.Length > 60)
                return Results.Problem("身份标识不能为空且不超过 60 字符", statusCode: 400);

            // 免密认人必须防枚举：连续失败 5 次锁 5 分钟（per device）
            if (DeviceAuthService.IsIdLoginLocked(device.Id))
                return Results.Problem("认人尝试过于频繁，请稍后再试", statusCode: 429);

            // 认人输入：**学号优先**（队员互知的现实标识），兼容登录名与历史 /u/{slug} 短链
            var slug = ExtractSlug(identifier);
            var user = await db.Users.FirstOrDefaultAsync(u =>
                u.StudentId == identifier || u.Slug == slug || u.Username == identifier);
            if (user is null)
            {
                DeviceAuthService.RegisterIdLoginFailure(device.Id);
                log.Audit("device-login-noauth", $"device:{device.DeviceKey}", targetType: "device",
                    targetId: device.Id.ToString(),
                    data: new { identifier, success = false }, ipAddress: LogService.ClientIp(ctx));
                return Results.Problem("没有找到该身份标识对应的用户", statusCode: 404);
            }

            // 身份挂失：学号泄露/被冒名后管理员一键挂失，免密认人立即失效
            if (user.IdentityDisabled)
                return Results.Problem("该成员身份已挂失，学号认人已停用", statusCode: 403);

            DeviceAuthService.ClearIdLoginFailures(device.Id);
            var (session, token) = await auth.CreateSessionAsync(device, user, ctx, method: "idcode");
            log.Audit("device-login-noauth", $"device:{device.DeviceKey}", targetType: "user",
                targetId: user.Id.ToString(),
                data: new { identifier, username = user.Username, sessionId = session.Id },
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new
            {
                sessionToken = token,
                expiresAt = session.ExpiresAt,
                user = new { user.Id, user.Username, DisplayName = user.DisplayName, user.StudentId, user.Role },
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
            DeviceAuthService auth, InventoryService items, AppDbContext db, PermissionService perms) =>
        {
            var device = await auth.AuthenticateAsync(ctx);
            if (device is null) return Unauthorized();
            // 物料位置属于敏感信息：设备必须已登录队员身份，且按该队员的权限与等级过滤。
            // 只有设备凭据（无人身份）不再能读库位。
            var session = await auth.AuthenticateSessionAsync(ctx, device);
            if (session is null) return Results.Problem("请先在设备上登录队员身份", statusCode: 401);

            var item = await items.GetByCode(code);
            if (item is null) return Results.Problem("没有找到这个编码对应的物料", statusCode: 404);
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == session.UserId);
            var canRead = user is not null
                && perms.Has(user.Role, "material.inventory.view")
                && perms.Has(user.Role, "material.inventory.view." + item.Grade.ToLowerInvariant());
            if (!canRead) return Results.Problem("没有找到这个编码对应的物料", statusCode: 404);

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
            // clamp：防 int.MinValue 时 Math.Abs 溢出（500），也防异常大的单次上报
            // 单次变更限幅：原来 ±100 万足以一次把库存改没/改爆，收紧到 ±1000
            if (req.Delta > 1_000 || req.Delta < -1_000)
                return Results.Problem("Delta 超出允许范围（±1000）", statusCode: 400);

            var found = await db.InventoryItems
                .FirstOrDefaultAsync(i => i.Code != null && i.Code == code.ToUpperInvariant());
            if (found is null) return Results.Problem("没有找到这个编码对应的物料", statusCode: 404);

            // 并发修复：原来是「读 Quantity → 算新值 → 写回」，两台设备同时上报会互相覆盖（丢失更新）。
            // 改成条件 UPDATE，由数据库在单条语句内完成累加；WHERE 的 >= 0 同时兜住扣成负数的情况。
            var now = DateTime.UtcNow;
            var updated = await db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE InventoryItems SET Quantity = Quantity + {req.Delta}, UpdatedAt = {now}
WHERE Id = {found.Id} AND Quantity + {req.Delta} >= 0");
            if (updated == 0)
            {
                // 0 行 = 条件不成立（库存不够扣）。重读当前值，错误信息仍带上"当前多少"，便于现场排查。
                var currentQty = await db.InventoryItems.AsNoTracking()
                    .Where(i => i.Id == found.Id).Select(i => i.Quantity).FirstOrDefaultAsync();
                return Results.Problem($"库存不足：当前 {currentQty}，变更 {req.Delta}", statusCode: 400);
            }

            // 原生 UPDATE 绕过 EF 跟踪，内存里的 found 仍是旧 Quantity；
            // 这里用 AsNoTracking 重查一次拿最新值返回，避免把过期数量报给设备。
            var latest = await db.InventoryItems.AsNoTracking().FirstAsync(i => i.Id == found.Id);
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
                data: new { item = found.Name, code = found.Code, delta = req.Delta, quantity = latest.Quantity, deviceId = device.Id },
                ipAddress: LogService.ClientIp(ctx));

            return Results.Ok(new { found.Id, latest.Quantity, delta = req.Delta });
        });
    }
}

/// <summary>遥测上报体：Payload 原样保存，不做结构约束。</summary>
public record TelemetryRequest(string? Kind, JsonElement? Payload);

/// <summary>库存变动上报体：Delta 正数入库、负数出库。</summary>
public record StockDeltaRequest(int Delta, string? Note);

/// <summary>设备内用户登录体：设备凭据已在请求头，这里只带用户账号密码。</summary>
public record DeviceLoginRequest(string Username, string Password);

/// <summary>设备终端现场认人体：身份码内容（/u/{slug} 或纯 slug/学号）。</summary>
public record DeviceLoginByIdRequest(string Identifier);
