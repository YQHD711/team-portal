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

    private static async Task<(string? role, string? dept)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }

    private static bool IsStaff(string? role) => role == "admin" || role == "部长";

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

        profileGroup.MapPut("/", async (UpdateProfileRequest req, ClaimsPrincipal user, ProfileService svc) =>
        {
            var userId = GetUserId(user);
            if (userId is null) return Results.Problem("未登录", statusCode: 401);

            var ok = await svc.UpdateProfile(userId.Value, req.Level, req.FlightHours, req.FirstFlight,
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

        // ── 管理端 ──
        var adminGroup = app.MapGroup("/api/admin/profiles").RequireAuthorization();

        adminGroup.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            return Results.Ok(await svc.ListAllProfiles());
        });

        adminGroup.MapGet("/{userId:int}", async (int userId, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可查看", statusCode: 403);
            var profile = await svc.GetFullProfile(userId);
            return profile is not null ? Results.Ok(profile) : Results.Problem("档案不存在", statusCode: 404);
        });

        adminGroup.MapPut("/{userId:int}", async (int userId, UpdateProfileRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var ok = await svc.UpdateProfile(userId, req.Level, req.FlightHours, req.FirstFlight,
                req.Bio, req.EmergencyContact, req.EmergencyPhone, req.FlightTypes, req.Skills);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("档案不存在", statusCode: 404);
        });

        // 培训记录
        adminGroup.MapPost("/{userId:int}/training", async (int userId, AddTrainingRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可添加", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.CourseName))
                return Results.Problem("课程名称不能为空", statusCode: 400);
            var record = await svc.AddTrainingRecord(userId, req.CourseName, req.Score, req.ExamDate, req.Examiner, req.Notes);
            return Results.Created($"/api/admin/profiles/{userId}/training/{record.Id}", record);
        });

        adminGroup.MapPut("/{userId:int}/training/{id:int}", async (int userId, int id, AddTrainingRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var ok = await svc.UpdateTrainingRecord(id, req.CourseName, req.Score, req.ExamDate, req.Examiner, req.Notes);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("记录不存在", statusCode: 404);
        });

        adminGroup.MapDelete("/{userId:int}/training/{id:int}", async (int userId, int id, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            var ok = await svc.DeleteTrainingRecord(id);
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("记录不存在", statusCode: 404);
        });

        // 参赛记录
        adminGroup.MapPost("/{userId:int}/competitions", async (int userId, AddCompetitionRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可添加", statusCode: 403);
            if (string.IsNullOrWhiteSpace(req.CompetitionName))
                return Results.Problem("比赛名称不能为空", statusCode: 400);
            var record = await svc.AddCompetitionRecord(userId, req.CompetitionName, req.Date, req.Event, req.Ranking, req.Certificate, req.Notes);
            return Results.Created($"/api/admin/profiles/{userId}/competitions/{record.Id}", record);
        });

        adminGroup.MapPut("/{userId:int}/competitions/{id:int}", async (int userId, int id, AddCompetitionRequest req, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可编辑", statusCode: 403);
            var ok = await svc.UpdateCompetitionRecord(id, req.CompetitionName, req.Date, req.Event, req.Ranking, req.Certificate, req.Notes);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("记录不存在", statusCode: 404);
        });

        adminGroup.MapDelete("/{userId:int}/competitions/{id:int}", async (int userId, int id, ClaimsPrincipal user, AppDbContext db, ProfileService svc) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (!IsStaff(role)) return Results.Problem("仅管理员和部长可删除", statusCode: 403);
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

public record AddCompetitionRequest(
    string CompetitionName,
    DateTime Date,
    string? Event,
    string? Ranking,
    string? Certificate,
    string? Notes
);
