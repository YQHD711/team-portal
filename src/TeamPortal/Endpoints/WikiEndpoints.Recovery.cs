using System.Security.Claims;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 源码工作区恢复端点。
///
/// 为什么需要：工作区建在容器 /tmp（未挂卷），部署重建容器就会整片清空，
/// 于是任务记录还在、文档也还在，但源码浏览 /blob 全部 404。
/// 「重新克隆」按需把源码拉回来——只下载源码，不调用 AI、不产生费用，
/// 也不必重跑一次昂贵的完整生成。
///
/// 单独拆一个文件是为了不让 WikiEndpoints.cs（已经远超 200 行）继续膨胀。
/// </summary>
public static partial class WikiEndpoints
{
    internal static void MapWorkspaceRecoveryEndpoints(RouteGroupBuilder wiki)
    {
        wiki.MapPost("/tasks/{id}/reclone", async (string id, ClaimsPrincipal user, AppDbContext db, WikiGeneratorService generator, HttpContext ctx) =>
        {
            var (role, _) = await GetUserCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可重新克隆", statusCode: 403);

            var task = await generator.GetTask(id);
            if (task is null) return Results.Problem("任务不存在", statusCode: 404);

            var result = await generator.CloneWorkspaceOnly(id);
            var log = ctx.RequestServices.GetRequiredService<LogService>();
            var actor = user.Identity?.Name ?? "unknown";
            if (result.Ok) log.Info("wiki", $"Wiki task {id} workspace re-cloned by {actor}");
            else log.Warn("wiki", $"Wiki task {id} workspace re-clone failed by {actor}: {result.Message}");
            log.Audit("reclone", actor, targetType: "wiki-task", targetId: id,
                data: new { success = result.Ok, workspacePath = result.WorkspacePath }, ipAddress: LogService.ClientIp(ctx));
            return result.Ok
                ? Results.Ok(new { success = true, workspacePath = result.WorkspacePath, message = result.Message })
                : Results.Problem(result.Message, statusCode: 400);
        });
    }
}
