using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Endpoints;

public static class StorageEndpoints
{
    private static async Task<(string? role, string? dept)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }

    private static bool IsStaff(string? role) => role == "admin" || role == "部长";

    private static bool IsValidLayout(StorageLayoutRequest req, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(req.RoomCode) || !req.RoomCode.All(char.IsDigit))
            error = "房间号必须为数字，如 1030";
        else if (string.IsNullOrWhiteSpace(req.RoomName))
            error = "房间名称不能为空";
        else if (req.Floor <= 0)
            error = "楼层必须大于 0";
        else if (string.IsNullOrWhiteSpace(req.LayoutJson))
        {
            // 旧表格模式：必须填写货架网格参数
            if (req.CabinetCount < 1 || req.CabinetCount > 99)
                error = "货架数必须在 1-99 之间";
            else if (req.ShelfCount < 1 || req.ShelfCount > 9)
                error = "层数必须在 1-9 之间";
            else if (req.PositionCount < 1 || req.PositionCount > 99)
                error = "位数必须在 1-99 之间";
        }
        else if (req.CabinetCount < 0 || req.CabinetCount > 99
                 || req.ShelfCount < 0 || req.ShelfCount > 9
                 || req.PositionCount < 0 || req.PositionCount > 99)
            error = "货架/层/位数超出允许范围";
        return error is null;
    }

    public static void MapStorageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/storage").RequireAuthorization();

        // 所有房间布局（按楼层、房间号排序）
        group.MapGet("/layouts", async (AppDbContext db) =>
        {
            var layouts = await db.StorageLayouts
                .OrderBy(l => l.Floor).ThenBy(l => l.RoomCode)
                .ToListAsync();
            return Results.Ok(layouts);
        });

        // 新增房间布局（admin/部长）
        group.MapPost("/layouts", async (StorageLayoutRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑库位布局", statusCode: 403);
            if (!IsValidLayout(req, out var err)) return Results.Problem(err, statusCode: 400);

            var exists = await db.StorageLayouts.AnyAsync(l => l.RoomCode == req.RoomCode);
            if (exists) return Results.Problem($"房间 {req.RoomCode} 已存在", statusCode: 409);

            var layout = new StorageLayout
            {
                RoomCode = req.RoomCode, RoomName = req.RoomName, Floor = req.Floor,
                CabinetCount = req.CabinetCount, ShelfCount = req.ShelfCount,
                PositionCount = req.PositionCount, Description = req.Description,
                LayoutJson = req.LayoutJson
            };
            db.StorageLayouts.Add(layout);
            await db.SaveChangesAsync();
            return Results.Created($"/api/storage/layouts/{layout.Id}", layout);
        });

        // 更新房间布局（admin/部长）
        group.MapPut("/layouts/{id:int}", async (int id, StorageLayoutRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑库位布局", statusCode: 403);
            if (!IsValidLayout(req, out var err)) return Results.Problem(err, statusCode: 400);

            var layout = await db.StorageLayouts.FindAsync(id);
            if (layout is null) return Results.Problem("布局不存在", statusCode: 404);

            var clash = await db.StorageLayouts.AnyAsync(l => l.RoomCode == req.RoomCode && l.Id != id);
            if (clash) return Results.Problem($"房间 {req.RoomCode} 已存在", statusCode: 409);

            layout.RoomCode = req.RoomCode;
            layout.RoomName = req.RoomName;
            layout.Floor = req.Floor;
            layout.CabinetCount = req.CabinetCount;
            layout.ShelfCount = req.ShelfCount;
            layout.PositionCount = req.PositionCount;
            layout.Description = req.Description;
            layout.LayoutJson = req.LayoutJson;
            layout.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(layout);
        });

        // 删除房间布局（仅 admin）
        group.MapDelete("/layouts/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin") return Results.Problem("仅管理员可删除房间布局", statusCode: 403);

            var layout = await db.StorageLayouts.FindAsync(id);
            if (layout is null) return Results.Problem("布局不存在", statusCode: 404);

            db.StorageLayouts.Remove(layout);
            await db.SaveChangesAsync();
            return Results.Ok(new { deleted = true });
        });

        // 某房间物料按库位分组（完整四段编码按编码分组，仅房间级/无编码归入 unlocated）
        group.MapGet("/layouts/{roomCode}/items", async (string roomCode, AppDbContext db) =>
        {
            var prefix = roomCode + "-";
            var items = await db.InventoryItems
                .Where(i => i.LocationCode != null && (i.LocationCode == roomCode || i.LocationCode.StartsWith(prefix)))
                .OrderBy(i => i.LocationCode).ThenBy(i => i.Name)
                .ToListAsync();
            var groups = items
                .GroupBy(i => i.LocationCode!.Split('-').Length >= 4 ? i.LocationCode! : "unlocated")
                .Select(g => new { locationCode = g.Key, items = g.ToList() })
                .OrderBy(g => g.locationCode == "unlocated" ? "~" : g.locationCode)
                .ToList();
            return Results.Ok(groups);
        });
    }
}

public record StorageLayoutRequest(string RoomCode, string RoomName, int Floor,
    int CabinetCount, int ShelfCount, int PositionCount, string? Description, string? LayoutJson);
