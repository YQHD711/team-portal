using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 设备管理端点（仅管理员）：签发/重置密钥、启停、查看最近遥测。
/// 设备接入本身见 <see cref="DeviceEndpoints"/>。
/// </summary>
public static class DeviceAdminEndpoints
{
    private const int OnlineWindowMinutes = 5;

    public static void MapDeviceAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/devices").RequireAuthorization("AdminOnly");

        group.MapGet("/", async (AppDbContext db) =>
        {
            var now = DateTime.UtcNow;
            var list = await db.Devices.AsNoTracking().OrderBy(d => d.Id).ToListAsync();
            return Results.Ok(list.Select(d => new
            {
                d.Id, d.Name, d.DeviceKey, d.Type, d.LocationCode, d.FirmwareVersion,
                d.Enabled, d.CreatedAt, d.LastSeenAt, d.LastSeenIp,
                online = d.Enabled && d.LastSeenAt is not null
                    && now - d.LastSeenAt.Value < TimeSpan.FromMinutes(OnlineWindowMinutes),
            }));
        });

        // 创建设备：Secret 只在这次响应里返回一次，之后只能重置
        group.MapPost("/", async (CreateDeviceRequest req, ClaimsPrincipal user,
            DeviceAuthService auth, LogService log, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.Problem("设备名称必填", statusCode: 400);

            var (device, secret) = await auth.CreateAsync(req.Name.Trim(), req.Type ?? "esp32", req.LocationCode);
            log.Audit("create", user.Identity?.Name ?? "unknown", targetType: "device",
                targetId: device.Id.ToString(),
                data: new { device.Name, device.Type, device.LocationCode },
                ipAddress: LogService.ClientIp(ctx));

            return Results.Created($"/api/admin/devices/{device.Id}", new
            {
                device.Id, device.Name, device.DeviceKey, device.Type, device.LocationCode,
                device.Enabled, device.CreatedAt, secret,
            });
        });

        group.MapPut("/{id:int}", async (int id, UpdateDeviceRequest req, ClaimsPrincipal user,
            AppDbContext db, LogService log, HttpContext ctx) =>
        {
            var d = await db.Devices.FindAsync(id);
            if (d is null) return Results.Problem("设备不存在", statusCode: 404);

            if (req.Name is not null) d.Name = req.Name.Trim();
            if (req.Type is not null) d.Type = req.Type;
            if (req.LocationCode is not null)
                d.LocationCode = string.IsNullOrWhiteSpace(req.LocationCode) ? null : req.LocationCode.Trim();
            if (req.FirmwareVersion is not null) d.FirmwareVersion = req.FirmwareVersion;
            if (req.Enabled.HasValue) d.Enabled = req.Enabled.Value;
            await db.SaveChangesAsync();

            log.Audit("update", user.Identity?.Name ?? "unknown", targetType: "device",
                targetId: d.Id.ToString(),
                data: new { d.Name, d.Type, d.LocationCode, d.Enabled },
                ipAddress: LogService.ClientIp(ctx));

            return Results.Ok(new
            {
                d.Id, d.Name, d.DeviceKey, d.Type, d.LocationCode,
                d.FirmwareVersion, d.Enabled, d.LastSeenAt,
            });
        });

        group.MapPost("/{id:int}/rotate-secret", async (int id, ClaimsPrincipal user,
            DeviceAuthService auth, LogService log, HttpContext ctx) =>
        {
            var secret = await auth.RotateSecretAsync(id);
            if (secret is null) return Results.Problem("设备不存在", statusCode: 404);

            log.Audit("rotate-secret", user.Identity?.Name ?? "unknown", targetType: "device",
                targetId: id.ToString(), data: new { success = true },
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { id, secret });
        });

        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db,
            LogService log, HttpContext ctx) =>
        {
            var d = await db.Devices.FindAsync(id);
            if (d is null) return Results.Problem("设备不存在", statusCode: 404);

            db.Devices.Remove(d);
            await db.SaveChangesAsync();
            log.Audit("delete", user.Identity?.Name ?? "unknown", targetType: "device",
                targetId: id.ToString(), data: new { d.Name, d.DeviceKey },
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = true });
        });

        group.MapGet("/{id:int}/telemetry", async (int id, int? limit, AppDbContext db) =>
        {
            var take = Math.Clamp(limit ?? 50, 1, 500);
            var rows = await db.DeviceTelemetries.AsNoTracking()
                .Where(t => t.DeviceId == id)
                .OrderByDescending(t => t.CreatedAt)
                .Take(take)
                .ToListAsync();
            return Results.Ok(rows);
        });
    }
}

public record CreateDeviceRequest(string Name, string? Type, string? LocationCode);
public record UpdateDeviceRequest(string? Name, string? Type, string? LocationCode,
    string? FirmwareVersion, bool? Enabled);
