using System.Security.Claims;
using System.Text.Json;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class ExamEndpoints
{
    // JsonElement.Deserialize 默认不走 camelCase,需显式指定与 Web API 一致的命名策略
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    public static void MapExamEndpoints(this WebApplication app)
    {
        // 部门考核管理(StaffOnly)
        var group = app.MapGroup("/api/admin/exams").RequireAuthorization("StaffOnly");

        group.MapGet("/", async (int? departmentId, ExamService svc) =>
            Results.Ok(await svc.ListExams(departmentId)));

        group.MapPost("/", async (ExamRequest req, ClaimsPrincipal user, ExamService svc, LogService log, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Title)) return Results.Problem("考核名称不能为空", statusCode: 400);
            if (InputSanitizer.HasUnsafeFragment(req.Title)) return Results.Problem("包含非法字符", statusCode: 400);
            if (!req.DepartmentId.HasValue) return Results.Problem("请选择部门", statusCode: 400);
            var exam = await svc.CreateExam(req.DepartmentId.Value, req.Title.Trim(), req.ExamType ?? "theory",
                req.Status ?? "ongoing", req.ExamDate, int.Parse(user.FindFirstValue("NameIdentifier") ?? "0"));
            log.Audit("exam", user.Identity?.Name ?? "unknown", "exam", exam.Id.ToString(),
                data: new { departmentId = exam.DepartmentId, title = exam.Title }, ipAddress: LogService.ClientIp(ctx));
            return Results.Created($"/api/admin/exams/{exam.Id}", exam);
        });

        group.MapPut("/{id:int}", async (int id, ExamRequest req, ExamService svc) =>
        {
            if (req.Title is not null && InputSanitizer.HasUnsafeFragment(req.Title))
                return Results.Problem("包含非法字符", statusCode: 400);
            var ok = await svc.UpdateExam(id, req.DepartmentId, req.Title, req.ExamType, req.Status, req.ExamDate);
            return ok ? Results.Ok(new { message = "已更新" }) : Results.Problem("考核不存在", statusCode: 404);
        });

        group.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, ExamService svc, LogService log, HttpContext ctx) =>
        {
            var ok = await svc.DeleteExam(id);
            if (ok) log.Audit("exam", user.Identity?.Name ?? "unknown", "exam", id.ToString(),
                data: new { action = "delete" }, ipAddress: LogService.ClientIp(ctx));
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("考核不存在", statusCode: 404);
        });

        group.MapGet("/passes", async (ExamService svc) =>
            Results.Ok(await svc.ListPassedResults()));

        // 个人端:自己的考核通过记录(团队认证只读来源)
        app.MapGet("/api/profile/exam-passes", async (ClaimsPrincipal user, ExamService svc) =>
        {
            var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (idClaim is null) return Results.Problem("未登录", statusCode: 401);
            return Results.Ok(await svc.ListPassedResults(int.Parse(idClaim)));
        });

        group.MapGet("/{id:int}/results", async (int id, ExamService svc) =>
            Results.Ok(await svc.GetResults(id)));

        // body 兼容单个对象或数组: {userId, passed, score?, notes?} 或 [{...}, ...]
        group.MapPost("/{id:int}/results", async (int id, JsonElement body, ClaimsPrincipal user, ExamService svc, LogService log, HttpContext ctx) =>
        {
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

        group.MapDelete("/{id:int}/results/{resultId:int}", async (int id, int resultId, ExamService svc) =>
        {
            var ok = await svc.DeleteResult(resultId);
            return ok ? Results.Ok(new { message = "已删除" }) : Results.Problem("结果不存在", statusCode: 404);
        });
    }
}

public record ExamRequest(int? DepartmentId, string? Title, string? ExamType, string? Status, DateTime? ExamDate);
