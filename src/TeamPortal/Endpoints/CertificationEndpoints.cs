using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class CertificationEndpoints
{
    private static int? GetUserId(ClaimsPrincipal user)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return idClaim is not null ? int.Parse(idClaim) : null;
    }

    private static async Task<(string? role, string? dept)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }

    private static bool IsStaff(string? role) => role == "admin" || role == "部长";

    public static void MapCertificationEndpoints(this WebApplication app)
    {
        // ── 个人技能认证(自己) ──
        var profileGroup = app.MapGroup("/api/profile").RequireAuthorization();

        profileGroup.MapGet("/certifications", async (ClaimsPrincipal user, CertificationService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.GetCertifications(userId.Value));
        });
        // 个人端点只读:认证只能由管理员/部长通过考核或管理端授予,队员不可自行添加/修改/删除。
        // 写操作见下方 /api/admin/profiles/{userId}/certifications(StaffOnly)。

        // ── 管理端:全部认证(组织架构页按 userId 分组) ──
        app.MapGet("/api/admin/certifications", async (CertificationService svc) => Results.Ok(await svc.ListAllCertifications()))
            .RequireAuthorization("StaffOnly");

        // ── 管理端:按队员查看认证(只读) ──
        var adminGroup = app.MapGroup("/api/admin/profiles").RequireAuthorization();

        adminGroup.MapGet("/{userId:int}/certifications", async (int userId, ClaimsPrincipal user, AppDbContext db, CertificationService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            return Results.Ok(await svc.GetCertifications(userId));
        });
        // 认证只读:认证只能由管理员/部长通过「发起考核 → 录入通过成绩」自动产生,
        // 不提供手动添加/编辑/删除入口(个人与管理端均不可)。见 DepartmentExamResults(passed=true)。
    }

    private static async Task<bool> OwnsCert(AppDbContext db, int certId, int userId)
    {
        return await db.SkillCertifications.AnyAsync(c => c.Id == certId && c.UserId == userId);
    }
}

public record CertificationRequest(
    string CertName,
    string? Level,
    string? Status,
    DateTime? CertDate,
    string? Notes
);
