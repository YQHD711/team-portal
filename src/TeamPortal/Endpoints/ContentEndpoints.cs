using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Endpoints;

/// <summary>
/// 「内容管理」的读取接口与个人引导进度。
///
/// 文案接口**必须匿名可读**：管理员可能改了登录页文案，而那时用户还没登录；
/// 接口只返回展示文本（不含任何业务数据），配限流防止被当免费 CDN。
/// 引导内容与进度需要登录。
/// </summary>
public static class ContentEndpoints
{
    private static readonly HashSet<string> Statuses = new(StringComparer.Ordinal)
    {
        "in_progress", "done", "skipped",
    };

    public static void MapContentEndpoints(this WebApplication app)
    {
        // 界面文案覆盖值：{ key: value }；未覆盖的 key 不出现在返回里，前端回落代码默认值
        app.MapGet("/api/content/texts", async (AppDbContext db) =>
        {
            var rows = await db.SiteTexts.AsNoTracking()
                .Select(t => new { t.Key, t.Value })
                .ToListAsync();
            return Results.Ok(rows.ToDictionary(r => r.Key, r => r.Value));
        }).RequireRateLimiting("default");

        // 管理员覆盖过的引导内容（停用的不下发）
        app.MapGet("/api/content/guides", async (AppDbContext db) =>
        {
            var rows = await db.GuideContents.AsNoTracking()
                .Where(g => g.Enabled)
                .Select(g => new { TourKey = g.TourKey, g.Title, g.StepsJson, g.Version })
                .ToListAsync();
            return Results.Ok(rows);
        }).RequireAuthorization();

        var me = app.MapGroup("/api/me/tours").RequireAuthorization();

        me.MapGet("", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = UserId(user);
            if (uid is null) return Results.Unauthorized();
            var rows = await db.UserTourProgresses.AsNoTracking()
                .Where(p => p.UserId == uid)
                .Select(p => new { TourKey = p.TourKey, p.Status, p.StepIndex, p.Version, p.UpdatedAt })
                .ToListAsync();
            return Results.Ok(rows);
        });

        // 进度上报：幂等 upsert，同一用户同一引导只留一行
        me.MapPut("/{key}", async (string key, TourProgressReq? req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = UserId(user);
            if (uid is null) return Results.Unauthorized();
            if (!ValidKey(key)) return Results.Problem("无效的引导标识", statusCode: 400);
            if (req is null || req.Status is null || !Statuses.Contains(req.Status))
                return Results.Problem("无效的引导状态", statusCode: 400);

            var row = await db.UserTourProgresses
                .FirstOrDefaultAsync(p => p.UserId == uid && p.TourKey == key);
            if (row is null)
            {
                row = new UserTourProgress { UserId = uid.Value, TourKey = key };
                db.UserTourProgresses.Add(row);
            }
            row.Status = req.Status;
            row.StepIndex = Math.Max(0, req.StepIndex);
            row.Version = Math.Max(0, req.Version);
            row.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { row.TourKey, row.Status, row.StepIndex, row.Version });
        });

        // 重置单条 / 全部（引导中心「重新开始」用；删行 = 回到未开始）
        me.MapDelete("/{key}", async (string key, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = UserId(user);
            if (uid is null) return Results.Unauthorized();
            await db.UserTourProgresses
                .Where(p => p.UserId == uid && p.TourKey == key)
                .ExecuteDeleteAsync();
            return Results.NoContent();
        });

        me.MapDelete("", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = UserId(user);
            if (uid is null) return Results.Unauthorized();
            await db.UserTourProgresses.Where(p => p.UserId == uid).ExecuteDeleteAsync();
            return Results.NoContent();
        });
    }

    private static int? UserId(ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    /// <summary>引导 key 由前端定义（小写字母/数字/连字符），长度受限防止被当作任意存储键</summary>
    private static bool ValidKey(string key) =>
        key.Length is > 0 and <= 60 && key.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-');
}

/// <summary>进度上报体：status ∈ in_progress/done/skipped，StepIndex 为当前步号</summary>
public sealed record TourProgressReq(string Status, int StepIndex, int Version);
