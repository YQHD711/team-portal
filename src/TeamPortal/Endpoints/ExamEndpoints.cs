using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class ExamEndpoints
{
    // JsonElement.Deserialize 默认不走 camelCase,需显式指定与 Web API 一致的命名策略
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    /// <summary>取调用者所属部门 id(以数据库为准,不信任可能过期的 token 声明)。</summary>
    private static async Task<int?> GetActorDeptIdAsync(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return null;
        var uid = int.Parse(idClaim);
        return await db.Users.Where(u => u.Id == uid).Select(u => (int?)u.DepartmentId).FirstOrDefaultAsync();
    }

    private static bool IsAdmin(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.Role) == "admin";

    /// <summary>
    /// 考核的部门范围:管理员不受限;部长只能操作本部门考核。
    /// 旧实现只判 StaffOnly,任何部长都能改删他部门考核、给任意队员写通过结果(自动产生认证)。
    /// </summary>
    private static async Task<IResult?> DenyIfOutOfScopeAsync(ClaimsPrincipal user, AppDbContext db, int examId)
    {
        if (IsAdmin(user)) return null;
        var examDeptId = await db.DepartmentExams.Where(e => e.Id == examId)
            .Select(e => (int?)e.DepartmentId).FirstOrDefaultAsync();
        if (examDeptId is null) return Results.Problem("考核不存在", statusCode: 404);
        var actorDeptId = await GetActorDeptIdAsync(user, db);
        if (actorDeptId is null || actorDeptId != examDeptId)
            return Results.Problem("仅可操作本部门考核", statusCode: 403);
        return null;
    }

    public static void MapExamEndpoints(this WebApplication app)
    {
        // 部门考核管理(StaffOnly)
        var group = app.MapGroup("/api/admin/exams").RequireAuthorization("StaffOnly");

        group.MapGet("/", async (int? departmentId, ClaimsPrincipal user, AppDbContext db, ExamService svc) =>
        {
            // 部长不能通过 departmentId 参数查看他部门考核(传 null 时也只返回本部门)
            if (!IsAdmin(user)) departmentId = await GetActorDeptIdAsync(user, db);
            return Results.Ok(await svc.ListExams(departmentId));
        });

        group.MapPost("/", async (ExamRequest req, ClaimsPrincipal user, AppDbContext db, ExamService svc, LogService log, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Title)) return Results.Problem("考核名称不能为空", statusCode: 400);
            if (InputSanitizer.HasUnsafeFragment(req.Title)) return Results.Problem("包含非法字符", statusCode: 400);
            if (!req.DepartmentId.HasValue) return Results.Problem("请选择部门", statusCode: 400);
            if (!IsAdmin(user))
            {
                var actorDeptId = await GetActorDeptIdAsync(user, db);
                if (actorDeptId is null || actorDeptId != req.DepartmentId)
                    return Results.Problem("仅可为本部门创建考核", statusCode: 403);
            }
            var exam = await svc.CreateExam(req.DepartmentId.Value, req.Title.Trim(), req.ExamType ?? "theory",
                req.Status ?? "ongoing", req.ExamDate, int.Parse(user.FindFirstValue("NameIdentifier") ?? "0"));
            log.Audit("exam", user.Identity?.Name ?? "unknown", "exam", exam.Id.ToString(),
                data: new { departmentId = exam.DepartmentId, title = exam.Title }, ipAddress: LogService.ClientIp(ctx));
            return Results.Created($"/api/admin/exams/{exam.Id}", exam);
        });

        group.MapPut("/{id:int}", async (int id, ExamRequest req, ClaimsPrincipal user, AppDbContext db, ExamService svc, LogService log, HttpContext ctx) =>
        {
            if (req.Title is not null && InputSanitizer.HasUnsafeFragment(req.Title))
                return Results.Problem("包含非法字符", statusCode: 400);
            if (await DenyIfOutOfScopeAsync(user, db, id) is { } denied) return denied;
            if (!IsAdmin(user) && req.DepartmentId.HasValue)
                return Results.Problem("仅管理员可调整考核所属部门", statusCode: 403);
            var ok = await svc.UpdateExam(id, req.DepartmentId, req.Title, req.ExamType, req.Status, req.ExamDate);
            if (ok) log.Audit("exam", user.Identity?.Name ?? "unknown", "exam", id.ToString(),
                data: new { action = "update", departmentId = req.DepartmentId, title = req.Title }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("考核不存在", statusCode: 404);
        });

        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, ExamService svc, LogService log, HttpContext ctx) =>
        {
            if (await DenyIfOutOfScopeAsync(user, db, id) is { } denied) return denied;
            var ok = await svc.DeleteExam(id);
            if (ok) log.Audit("exam", user.Identity?.Name ?? "unknown", "exam", id.ToString(),
                data: new { action = "delete" }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("考核不存在", statusCode: 404);
        });

        group.MapGet("/passes", async (ClaimsPrincipal user, AppDbContext db, ExamService svc) =>
        {
            // 团队认证总览含全队成员:管理员看全部,部长只看本部门
            if (IsAdmin(user)) return Results.Ok(await svc.ListPassedResults());
            var deptId = await GetActorDeptIdAsync(user, db);
            if (deptId is null) return Results.Ok(Array.Empty<object>());
            return Results.Ok(await svc.ListPassedResultsForDepartment(deptId.Value));
        });

        // 个人端:自己的考核通过记录(团队认证只读来源)
        app.MapGet("/api/profile/exam-passes", async (ClaimsPrincipal user, ExamService svc) =>
        {
            var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (idClaim is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.ListPassedResults(int.Parse(idClaim)));
        });

        group.MapGet("/{id:int}/results", async (int id, ClaimsPrincipal user, AppDbContext db, ExamService svc) =>
        {
            if (await DenyIfOutOfScopeAsync(user, db, id) is { } denied) return denied;
            return Results.Ok(await svc.GetResults(id));
        });

        // body 兼容单个对象或数组: {userId, passed, score?, notes?} 或 [{...}, ...]
        group.MapPost("/{id:int}/results", async (int id, JsonElement body, ClaimsPrincipal user, AppDbContext db, ExamService svc, LogService log, HttpContext ctx) =>
        {
            if (await DenyIfOutOfScopeAsync(user, db, id) is { } denied) return denied;
            var inputs = body.ValueKind == JsonValueKind.Array
                ? body.Deserialize<List<ExamResultInput>>(WebJson) ?? []
                : [body.Deserialize<ExamResultInput>(WebJson) ?? new(0, false, null, null)];
            inputs = inputs.Where(i => i.UserId > 0).ToList();
            if (inputs.Count == 0) return Results.Problem("请选择队员", statusCode: 400);

            var results = await svc.AddResults(id, inputs);
            log.Audit("exam", user.Identity?.Name ?? "unknown", "exam-result", id.ToString(),
                data: new { count = results.Count }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(results);
        });

        group.MapDelete("/{id:int}/results/{resultId:int}", async (int id, int resultId, ClaimsPrincipal user, AppDbContext db, ExamService svc, LogService log, HttpContext ctx) =>
        {
            if (await DenyIfOutOfScopeAsync(user, db, id) is { } denied) return denied;
            var ok = await svc.DeleteResult(resultId);
            if (ok) log.Audit("exam", user.Identity?.Name ?? "unknown", "exam-result", resultId.ToString(),
                data: new { action = "delete", examId = id }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("结果不存在", statusCode: 404);
        });
    }
}

public record ExamRequest(int? DepartmentId, string? Title, string? ExamType, string? Status, DateTime? ExamDate);
