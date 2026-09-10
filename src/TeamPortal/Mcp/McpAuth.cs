using System.Security.Claims;

namespace TeamPortal.Mcp;

/// <summary>
/// MCP 工具的统一鉴权边界。
/// <para>
/// <c>/mcp</c> 端点只要求"已认证"(Program.cs 的 MapMcp(...).RequireAuthorization()),
/// 不像 HTTP 端点那样有 MapGroup 上的 AdminOnly/StaffOnly 策略。
/// 因此每个工具**必须**自行比对与其对应 HTTP 端点同等的策略,
/// 否则任意登录成员都能通过 MCP 调用他本无权执行的运维/管理操作
/// (读系统设置里的明文密钥、改 AI 网关地址、恢复/删除备份、执行维护、越权审批等)。
/// </para>
/// </summary>
internal static class McpAuth
{
    public const string Forbidden = "Forbidden: 当前账号权限不足";

    public static string? Role(IHttpContextAccessor http) => http.HttpContext?.User?.FindFirst(ClaimTypes.Role)?.Value;

    public static string? Department(IHttpContextAccessor http) => http.HttpContext?.User?.FindFirst("Department")?.Value;

    public static int UserId(IHttpContextAccessor http) =>
        int.TryParse(http.HttpContext?.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : 0;

    /// <summary>等价于 HTTP 的 "AdminOnly" 策略。</summary>
    public static bool IsAdmin(IHttpContextAccessor http) => Role(http) == "admin";

    /// <summary>等价于 HTTP 的 "StaffOnly" 策略(admin 或 部长)。</summary>
    public static bool IsStaff(IHttpContextAccessor http) => Role(http) is "admin" or "部长";
}
