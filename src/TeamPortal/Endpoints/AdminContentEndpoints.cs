using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 管理员维护「内容管理」：界面文案覆盖 + 引导内容覆盖（仅 admin）。
///
/// 只允许覆盖前端 catalog / registry 里已经存在的 key——后端无法凭空造出界面元素。
/// 删除覆盖行 = 恢复代码默认值，所以「重置」不涉及任何数据迁移。
/// </summary>
public static class AdminContentEndpoints
{
    private const int MaxTextLength = 4000;
    private const int MaxStepsJsonLength = 100_000;

    public static void MapAdminContentEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/content").RequireAuthorization("AdminOnly");

        group.MapGet("/texts", async (AppDbContext db) =>
        {
            var rows = await db.SiteTexts.AsNoTracking()
                .OrderBy(t => t.Group).ThenBy(t => t.Key)
                .Select(t => new { t.Key, t.Value, t.Group, t.UpdatedAt })
                .ToListAsync();
            return Results.Ok(rows);
        });

        // 批量保存：value 为空串表示删除覆盖（回到代码默认值）
        group.MapPut("/texts", async (SiteTextBatch? body, ClaimsPrincipal user, AppDbContext db,
            LogService log, HttpContext ctx) =>
        {
            if (body?.Items is null || body.Items.Count == 0)
                return Results.Problem("没有要保存的文案", statusCode: 400);
            if (body.Items.Count > 500)
                return Results.Problem("单次最多保存 500 条", statusCode: 400);

            var invalid = body.Items.FirstOrDefault(i => !ValidKey(i.Key));
            if (invalid is not null) return Results.Problem($"无效的文案 key：{invalid.Key}", statusCode: 400);
            var tooLong = body.Items.FirstOrDefault(i => (i.Value?.Length ?? 0) > MaxTextLength);
            if (tooLong is not null) return Results.Problem($"文案过长：{tooLong.Key}", statusCode: 400);

            var keys = body.Items.Select(i => i.Key).ToList();
            var existing = await db.SiteTexts.Where(t => keys.Contains(t.Key)).ToListAsync();
            int saved = 0, removed = 0;

            foreach (var item in body.Items)
            {
                var row = existing.FirstOrDefault(t => t.Key == item.Key);
                if (string.IsNullOrEmpty(item.Value))
                {
                    if (row is not null) { db.SiteTexts.Remove(row); removed++; }
                    continue;
                }
                if (row is null)
                {
                    row = new SiteText { Key = item.Key };
                    db.SiteTexts.Add(row);
                    existing.Add(row);
                }
                row.Value = item.Value;
                row.UpdatedAt = DateTime.UtcNow;
                saved++;
            }

            await db.SaveChangesAsync();
            var userName = user.Identity?.Name ?? "unknown";
            log.Audit("content.update", userName, targetType: "site-text",
                data: new { saved, removed, keys = keys.Take(20) }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { saved, removed });
        });

        group.MapDelete("/texts/{key}", async (string key, ClaimsPrincipal user, AppDbContext db) =>
        {
            var n = await db.SiteTexts.Where(t => t.Key == key).ExecuteDeleteAsync();
            var userName = user.Identity?.Name ?? "unknown";
            return Results.Ok(new { removed = n, by = userName });
        });

        // 引导内容：列出全部（含停用），前端与代码默认值合并显示
        group.MapGet("/guides", async (AppDbContext db) =>
        {
            var rows = await db.GuideContents.AsNoTracking()
                .OrderBy(g => g.TourKey)
                .Select(g => new { TourKey = g.TourKey, g.Title, g.StepsJson, g.Enabled, g.Version, g.UpdatedAt })
                .ToListAsync();
            return Results.Ok(rows);
        });

        group.MapPut("/guides/{tourKey}", async (string tourKey, GuideUpsertReq? body, ClaimsPrincipal user,
            AppDbContext db, LogService log, HttpContext ctx) =>
        {
            if (!ValidKey(tourKey)) return Results.Problem("无效的引导标识", statusCode: 400);
            if (body is null) return Results.Problem("请求体为空", statusCode: 400);
            if ((body.Title?.Length ?? 0) > 200) return Results.Problem("标题过长", statusCode: 400);
            if ((body.StepsJson?.Length ?? 0) > MaxStepsJsonLength)
                return Results.Problem("步骤内容过长", statusCode: 400);
            if (!string.IsNullOrEmpty(body.StepsJson) && !IsJsonArray(body.StepsJson))
                return Results.Problem("步骤内容必须是 JSON 数组", statusCode: 400);

            var row = await db.GuideContents.FirstOrDefaultAsync(g => g.TourKey == tourKey);
            if (row is null)
            {
                row = new GuideContent { TourKey = tourKey };
                db.GuideContents.Add(row);
            }
            if (body.Title is not null) row.Title = body.Title;
            if (body.StepsJson is not null) row.StepsJson = body.StepsJson;
            if (body.Enabled is not null) row.Enabled = body.Enabled.Value;
            if (body.Version is not null) row.Version = Math.Max(0, body.Version.Value);
            row.UpdatedByUserId = UserId(user);
            row.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var userName = user.Identity?.Name ?? "unknown";
            log.Audit("content.update", userName, targetType: "guide", targetId: tourKey,
                data: new { enabled = row.Enabled, version = row.Version }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { row.TourKey, row.Enabled, row.Version });
        });

        group.MapDelete("/guides/{tourKey}", async (string tourKey, AppDbContext db) =>
        {
            var n = await db.GuideContents.Where(g => g.TourKey == tourKey).ExecuteDeleteAsync();
            return Results.Ok(new { removed = n });
        });
    }

    private static int? UserId(ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    private static bool ValidKey(string key) =>
        key.Length is > 0 and <= 120
        && key.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '-' or '_');

    /// <summary>StepsJson 必须是 JSON 数组：写库前拦住，避免前端 JSON.parse 时才炸</summary>
    private static bool IsJsonArray(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Array;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

/// <summary>批量文案保存的一行</summary>
public sealed record SiteTextItem(string Key, string? Value);

/// <summary>批量文案保存请求：Items 内的空 Value 表示删除覆盖</summary>
public sealed record SiteTextBatch(List<SiteTextItem>? Items);

/// <summary>引导内容覆盖请求：字段为 null 表示保持原值</summary>
public sealed record GuideUpsertReq(string? Title, string? StepsJson, bool? Enabled, int? Version);
