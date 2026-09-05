using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class ProfileEndpoints
{
    private static int? GetUserId(ClaimsPrincipal user)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return idClaim is not null ? int.Parse(idClaim) : null;
    }

    private static async Task<(string? role, int? deptId, int? actorId)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null, null);
        var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null, null) : (u.Role, u.DepartmentId, u.Id);
    }

    private static bool IsStaff(string? role) => role == "admin" || role == "部长";

    /// <summary>部长只能管理本部门成员；跨部门/未分配部门成员/自审 → 仅 admin 可操作。</summary>
    public static async Task<bool> CanManageAsync(string? actorRole, int? actorDeptId, int? actorId,
        AppDbContext db, int targetUserId)
    {
        if (actorRole == "admin") return true;
        if (actorRole != "部长" || actorId == targetUserId || !actorDeptId.HasValue) return false;
        var targetDeptId = await db.Users.AsNoTracking()
            .Where(u => u.Id == targetUserId).Select(u => u.DepartmentId).FirstOrDefaultAsync();
        return targetDeptId == actorDeptId;
    }

    /// <summary>写操作统一门禁：非 staff → 403；staff 但无权管理该成员 → 403。返回 null 表示放行。</summary>
    private static async Task<IResult?> RequireCanManageAsync(ClaimsPrincipal user, AppDbContext db, int targetUserId)
    {
        var (role, deptId, actorId) = await GetUserCtx(user, db);
        if (!IsStaff(role)) return Results.Problem("仅管理员和部长可操作", statusCode: 403);
        if (!await CanManageAsync(role, deptId, actorId, db, targetUserId))
            return Results.Problem("仅管理员和本部门部长可操作该成员", statusCode: 403);
        return null;
    }

    public static void MapProfileEndpoints(this WebApplication app)
    {
        // ── 个人档案 ──
        var profileGroup = app.MapGroup("/api/profile").RequireAuthorization();

        profileGroup.MapGet("/", async (ClaimsPrincipal user, ProfileService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);

            var profile = await svc.GetOrCreateProfile(userId.Value);
            var training = await svc.GetTrainingRecords(userId.Value);
            var competitions = await svc.GetCompetitionRecords(userId.Value);

            return Results.Ok(new
            {
                profile.Id, profile.UserId, profile.Level, profile.TotalFlightHours,
                profile.FirstFlightDate, profile.Bio, profile.EmergencyContact,
                profile.EmergencyPhone, profile.FlightTypes, profile.Skills, profile.UpdatedAt,
                TrainingRecords = training,
                CompetitionRecords = competitions
            });
        });

        // 自改接口：等级/时长属组织评定，个人不传(服务端不更新)，其余自填字段保留
        profileGroup.MapPut("/", async (UpdateProfileRequest req, ClaimsPrincipal user, ProfileService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);

            var ok = await svc.UpdateProfile(userId.Value, null, null, req.FirstFlight,
                req.Bio, req.EmergencyContact, req.EmergencyPhone, req.FlightTypes, req.Skills);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("档案不存在", statusCode: 404);
        });

        profileGroup.MapGet("/training", async (ClaimsPrincipal user, ProfileService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.GetTrainingRecords(userId.Value));
        });

        profileGroup.MapGet("/competitions", async (ClaimsPrincipal user, ProfileService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.GetCompetitionRecords(userId.Value));
        });

        // ── 管理端(查看全员,写操作限部门) ──
        var adminGroup = app.MapGroup("/api/admin/profiles").RequireAuthorization();

        adminGroup.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            return Results.Ok(await svc.ListAllProfiles());
        });

        adminGroup.MapGet("/{userId:int}", async (int userId, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            var profile = await svc.GetFullProfile(userId);
            return profile is not null ? Results.Ok(profile) : Results.Problem("档案不存在", statusCode: 404);
        });

        adminGroup.MapPut("/{userId:int}", async (int userId, UpdateProfileRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            var ok = await svc.UpdateProfile(userId, req.Level, req.FlightHours, req.FirstFlight,
                req.Bio, req.EmergencyContact, req.EmergencyPhone, req.FlightTypes, req.Skills);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("档案不存在", statusCode: 404);
        });

        // 培训记录
        adminGroup.MapPost("/{userId:int}/training", async (int userId, [FromBody] AddTrainingRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            if (string.IsNullOrWhiteSpace(req.CourseName))
                return Results.Problem("课程名称不能为空", statusCode: 400);
            var record = await svc.AddTrainingRecord(userId, req.CourseName, req.Score, req.ExamDate, req.Examiner, req.Notes);
            return Results.Created($"/api/admin/profiles/{userId}/training/{record.Id}", record);
        });

        adminGroup.MapPut("/{userId:int}/training/{id:int}", async (int userId, int id, [FromBody] AddTrainingRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            var ok = await svc.UpdateTrainingRecord(id, req.CourseName, req.Score, req.ExamDate, req.Examiner, req.Notes);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("记录不存在", statusCode: 404);
        });

        adminGroup.MapDelete("/{userId:int}/training/{id:int}", async (int userId, int id, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            var ok = await svc.DeleteTrainingRecord(id);
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("记录不存在", statusCode: 404);
        });

        // 培训批量录入:独立 group /api/admin/training;部长仅可勾选本部门其他成员
        var trainingAdmin = app.MapGroup("/api/admin/training").RequireAuthorization();
        trainingAdmin.MapPost("/batch", async (BatchTrainingRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, deptId, actorId) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可批量录入", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.CourseName))
                return Results.Problem("课程名称不能为空", statusCode: 400);
            if (req.UserIds is null || req.UserIds.Count == 0)
                return Results.Problem("请至少选择一位队员", statusCode: 400);

            if (role == "部长")
            {
                var allowed = await db.Users.AsNoTracking()
                    .Where(u => u.Id != actorId && u.DepartmentId == deptId && req.UserIds.Contains(u.Id))
                    .Select(u => u.Id).ToListAsync();
                if (allowed.Count == 0) return Results.Problem("仅可为本部门队员批量录入", statusCode: 403);
                req = req with { UserIds = allowed };
            }
            try
            {
                var count = await svc.BatchAddTrainingForUsers(req.UserIds, req.CourseName, req.ExamDate, req.Score, req.Examiner, req.Notes);
                return Results.Ok(new { count, message = $"已为 {count} 人录入培训" });
            }
            catch (ArgumentException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // 参赛记录
        adminGroup.MapPost("/{userId:int}/competitions", async (int userId, [FromBody] AddCompetitionRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            if (string.IsNullOrWhiteSpace(req.CompetitionName))
                return Results.Problem("比赛名称不能为空", statusCode: 400);
            var record = await svc.AddCompetitionRecord(userId, req.CompetitionName, req.Date, req.Event, req.Ranking, req.Certificate, req.Notes);
            return Results.Created($"/api/admin/profiles/{userId}/competitions/{record.Id}", record);
        });

        adminGroup.MapPut("/{userId:int}/competitions/{id:int}", async (int userId, int id, [FromBody] AddCompetitionRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            var ok = await svc.UpdateCompetitionRecord(id, req.CompetitionName, req.Date, req.Event, req.Ranking, req.Certificate, req.Notes);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("记录不存在", statusCode: 404);
        });

        adminGroup.MapDelete("/{userId:int}/competitions/{id:int}", async (int userId, int id, [FromBody] AddCompetitionRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            if (await RequireCanManageAsync(user, db, userId) is { } denied) return denied;
            var ok = await svc.DeleteCompetitionRecord(id);
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("记录不存在", statusCode: 404);
        });
    }
}

// ── Request DTOs ──

public record UpdateProfileRequest(
    string? Level,
    double? FlightHours,
    DateTime? FirstFlight,
    string? Bio,
    string? EmergencyContact,
    string? EmergencyPhone,
    string? FlightTypes,
    string? Skills = null
);

public record AddTrainingRequest(
    string CourseName,
    double? Score,
    DateTime ExamDate,
    string? Examiner,
    string? Notes
);

public record BatchTrainingRequest(
    List<int> UserIds,
    string CourseName,
    DateTime ExamDate,
    double? Score,
    string? Examiner,
    string? Notes
);

public record AddCompetitionRequest(
    string CompetitionName,
    DateTime Date,
    string? Event,
    string? Ranking,
    string? Certificate,
    string? Notes
);
