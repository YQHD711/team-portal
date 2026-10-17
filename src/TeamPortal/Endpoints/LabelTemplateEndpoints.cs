using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 标签模板端点（task-17，契约已冻结）：
/// <code>
/// GET    /api/label-templates            → 200 { templates: [LabelTemplate] }   任意登录用户（导出要用）
/// POST   /api/label-templates            → 200 LabelTemplate                     AdminOnly
/// PUT    /api/label-templates/{id}       → 200 LabelTemplate                     AdminOnly
/// DELETE /api/label-templates/{id}       → 200 { ok: true, defaultId }            AdminOnly
/// POST   /api/label-templates/{id}/default → 200 LabelTemplate                    AdminOnly
/// </code>
/// 校验失败 400 + 可读原因；找不到 id 404。写入一律"先校验后改库"，拒绝时不碰已有模板。
/// </summary>
public static class LabelTemplateEndpoints
{
    public static void MapLabelTemplateEndpoints(this WebApplication app)
    {
        // 导出要用模板，所以读取放开给任意登录用户；写入是全队共用的打印规范 → AdminOnly
        app.MapGet("/api/label-templates", async (LabelTemplateService svc) =>
            Results.Ok(new { templates = await svc.ListAsync() })).RequireAuthorization();

        var admin = app.MapGroup("/api/label-templates").RequireAuthorization("AdminOnly");

        admin.MapPost("/", async (LabelTemplateDto req, LabelTemplateService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            if (LabelTemplateValidation.Validate(req) is { } reason) return Results.Problem(reason, statusCode: 400);
            // kind=location 必须可用（同前端 locationLabelSuitability）；不适合则拒绝并给逐条原因
            if (LabelTemplateSuitability.Check(req.Kind, req.Elements) is { Count: > 0 } fitReasons) return Results.Problem(string.Join("；", fitReasons), statusCode: 400);
            var saved = await svc.CreateAsync(req, Actor(user));
            log.Audit("create-label-template", Actor(user), targetType: "label-template", targetId: saved.Id.ToString(),
                data: new { saved.Name, elements = saved.Elements.Count }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(saved);
        });

        admin.MapPut("/{id:int}", async (int id, LabelTemplateDto req, LabelTemplateService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            if (LabelTemplateValidation.Validate(req) is { } reason) return Results.Problem(reason, statusCode: 400);
            // kind=location 必须可用（同前端 locationLabelSuitability）；不适合则拒绝并给逐条原因
            if (LabelTemplateSuitability.Check(req.Kind, req.Elements) is { Count: > 0 } fitReasons) return Results.Problem(string.Join("；", fitReasons), statusCode: 400);
            var saved = await svc.UpdateAsync(id, req, Actor(user));
            if (saved is null) return Results.Problem("模板不存在", statusCode: 404);
            log.Audit("update-label-template", Actor(user), targetType: "label-template", targetId: id.ToString(),
                data: new { saved.Name, elements = saved.Elements.Count }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(saved);
        });

        admin.MapDelete("/{id:int}", async (int id, LabelTemplateService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            if (!await svc.DeleteAsync(id)) return Results.Problem("模板不存在", statusCode: 404);
            var templates = await svc.ListAsync();
            log.Audit("delete-label-template", Actor(user), targetType: "label-template", targetId: id.ToString(),
                ipAddress: LogService.ClientIp(ctx));
            // 顺手把"当前默认是谁"带回去，前端删掉默认模板后能立刻知道被提升成了哪个
            return Results.Ok(new { ok = true, defaultId = templates.FirstOrDefault(t => t.IsDefault)?.Id });
        });

        admin.MapPost("/{id:int}/default", async (int id, LabelTemplateService svc, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var saved = await svc.SetDefaultAsync(id);
            if (saved is null) return Results.Problem("模板不存在", statusCode: 404);
            log.Audit("set-default-label-template", Actor(user), targetType: "label-template", targetId: id.ToString(),
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(saved);
        });
    }

    private static string Actor(ClaimsPrincipal user) => user.Identity?.Name ?? "unknown";
}
