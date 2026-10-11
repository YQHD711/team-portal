using System.Security.Claims;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// P0-1 中英桥接索引的手动入口与进度查询（staff：admin + 部长，与知识库写操作一致）。
///
/// 触发是"立即返回"的：一轮最多处理 300 篇、每篇一次 AI 调用，不可能放在 HTTP 请求里等；
/// 前端/运维轮询 <c>GET /status</c> 看进度。
/// </summary>
public static class KnowledgeBridgingEndpoints
{
    public static void MapKnowledgeBridgingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/knowledge/bridging").RequireAuthorization("StaffOnly");

        group.MapGet("/status", (KnowledgeBridgingIndexService bridging) => Results.Ok(bridging.Status()));

        group.MapPost("/run", (bool? force, KnowledgeBridgingIndexService bridging, LogService log,
            ClaimsPrincipal user, HttpContext ctx) =>
        {
            var started = bridging.TryStart(force == true);
            var actor = user.Identity?.Name ?? "unknown";
            if (!started)
                return Results.Json(new { started = false, message = "已有一次桥接索引任务在运行" }, statusCode: 409);

            log.Info("ai", $"知识库中文桥接索引手动触发 by {actor}（force={force == true}）");
            log.Audit("run-bridging-index", actor, targetType: "knowledge-bridging", targetId: "bridging",
                data: new { force = force == true }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { started = true, status = bridging.Status() });
        });
    }
}
