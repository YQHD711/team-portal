using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class WeChatAuthEndpoints
{
    public static void MapWeChatAuthEndpoints(this WebApplication app)
    {
        // 微信授权回调：微信带 code+state 302 到这里。命中绑定 → 302 前端首页带正式 token；
        // 未绑定 → 302 绑定页带绑定票据；失败 → 302 登录页带错误码。
        app.MapGet("/api/auth/wechat/callback", async (
            string? code, string? state, WeChatAuthService wechat, SettingsService settings) =>
        {
            var frontBase = await settings.Get("WeChat:FrontBaseUrl", "http://localhost:3000");
            if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
                return Results.Redirect($"{frontBase}/auth/login?error=wechat_missing_params");

            var result = await wechat.HandleCallbackAsync(code, state);
            return result.Kind switch
            {
                "bound" => Results.Redirect($"{frontBase}/?token={Uri.EscapeDataString(result.Token!)}"),
                "unbound" => Results.Redirect($"{frontBase}/auth/wechat/bind?binding={Uri.EscapeDataString(result.BindingToken!)}"),
                _ => Results.Redirect($"{frontBase}/auth/login?error=wechat_{result.ErrorCode}"),
            };
        });

        // 首次微信登录：绑定现有账号。绑定票据（短效 JWT）必须有效；账号密码校验失败不绑定。
        app.MapPost("/api/auth/wechat/bind", async (
            WeChatBindRequest? req, WeChatAuthService wechat, AuthService auth,
            SettingsService settings, LogService log, HttpContext ctx) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.BindingToken)
                || string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("请求参数不完整", statusCode: 400);

            if (!await settings.GetBool("WeChat:Enabled", false))
                return Results.Problem("微信登录未启用", statusCode: 403);

            var binding = wechat.ValidateBindingToken(req.BindingToken);
            if (binding is null)
                return Results.Problem("绑定票据无效或已过期，请重新通过微信进入", statusCode: 400);

            var user = await auth.LoginAndGetUser(req.Username.Trim(), req.Password);
            if (user is null)
            {
                log.Warn("wechat", $"微信绑定失败（账号密码错误）: {req.Username}", null, req.Username);
                return Results.Problem("用户名或密码错误", statusCode: 401);
            }

            var bound = await wechat.BindOpenId(user.Id, binding.Value.OpenId, binding.Value.UnionId);
            if (!bound)
                return Results.Problem("该微信已绑定其他账号，或该账号已绑定其他微信", statusCode: 409);

            log.Audit("wechat-bind", user.Username, targetType: "user", targetId: user.Id.ToString(),
                data: new { success = true, openid = binding.Value.OpenId }, ipAddress: LogService.ClientIp(ctx), userId: user.Id);

            var token = await auth.IssueTokenFor(user);
            return Results.Ok(new { token });
        }).RequireRateLimiting("login");

        // 解绑微信：需登录 + 当前密码校验。
        app.MapPost("/api/auth/wechat/unbind", async (
            WeChatUnbindRequest? req, ClaimsPrincipal user, WeChatAuthService wechat,
            LogService log, HttpContext ctx) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("请输入当前密码", statusCode: 400);
            var idClaim = user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (idClaim is null || !int.TryParse(idClaim, out var userId))
                return Results.Problem("未登录", statusCode: 401);

            var ok = await wechat.UnbindWeChat(userId, req.Password);
            if (!ok) return Results.Problem("密码错误或未绑定微信", statusCode: 400);

            log.Audit("wechat-unbind", user.Identity?.Name ?? "unknown", targetType: "user", targetId: idClaim,
                data: new { success = true }, ipAddress: LogService.ClientIp(ctx), userId: userId);
            return Results.Ok(new { success = true });
        }).RequireAuthorization();

        // 公开探测：登录页/绑定页判断是否显示微信入口。不暴露 AppSecret。
        app.MapGet("/api/public/wechat-config", async (WeChatAuthService wechat) =>
        {
            var authUrl = await wechat.BuildAuthorizeUrlAsync();
            return Results.Ok(new { enabled = authUrl is not null, authUrl });
        });
    }
}

public record WeChatBindRequest(string BindingToken, string Username, string Password);
public record WeChatUnbindRequest(string Password);
