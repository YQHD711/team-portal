using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 账号/部门管理工具。策略对齐 HTTP 侧: /api/admin 组为 StaffOnly,
/// 其中删除用户、新建部门为 AdminOnly(AdminEndpoints 的 MapPost/MapDelete 显式收紧)。
/// 写操作补 OperationLog 审计,与 HTTP 端点一致;审计 data 不含口令。
/// </summary>
[McpServerToolType]
public class AdminTools
{
    private readonly AdminService _admin;
    private readonly IHttpContextAccessor _http;
    private readonly LogService? _log;
    public AdminTools(AdminService admin, IHttpContextAccessor http, LogService? log = null)
    { _admin = admin; _http = http; _log = log; }

    private (string? role, string? dept, int uid) GetUser() => (McpAuth.Role(_http), McpAuth.Department(_http), McpAuth.UserId(_http));

    private void Audit(string action, string targetType, string? targetId, object data)
        => _log?.Audit(action, McpAuth.UserName(_http), targetType: targetType, targetId: targetId,
            data: data, ipAddress: McpAuth.ClientIp(_http), userId: McpAuth.UserId(_http));

    [McpServerTool(Name = "admin_list_users")]
    public async Task<object> ListUsers(string? role = null, string? dept = null)
    {
        var (r, d, i) = GetUser();
        if (r != "admin" && r != "部长") return McpAuth.Forbidden;
        // 审计 A-05：不接受调用者覆盖 role/dept（传 role="admin" 可绕过部长的部门过滤读全队）。
        // 与 HTTP /api/admin/users 一致，只用登录身份里的真实角色/部门；参数保留仅为兼容，忽略。
        _ = role; _ = dept;
        return await _admin.ListUsers(r, d, i);
    }

    [McpServerTool(Name = "admin_create_user")]
    public async Task<object?> CreateUser(string username, string password, string userRole = "member", int? deptId = null)
    {
        var (r, d, _) = GetUser();
        if (r != "admin") return McpAuth.Forbidden;
        var u = await _admin.CreateUser(username, password, userRole, deptId, r, d);
        Audit("create", "user", u?.Id.ToString(), new { via = "mcp", username, role = userRole, departmentId = deptId, success = u is not null });
        return u;
    }

    [McpServerTool(Name = "admin_update_user")]
    public async Task<bool> UpdateUser(int id, string? userRole = null, int? deptId = null, string? password = null)
    {
        var (r, d, u) = GetUser();
        if (r != "admin") return false;
        var ok = await _admin.UpdateUser(id, userRole, deptId, password, null, r, d, u);
        Audit("update", "user", id.ToString(), new { via = "mcp", success = ok, role = userRole, departmentId = deptId, passwordChanged = password is not null });
        return ok;
    }

    [McpServerTool(Name = "admin_delete_user")]
    public async Task<bool> DeleteUser(int id)
    {
        var (r, d, _) = GetUser();
        if (r != "admin") return false;
        var ok = await _admin.DeleteUser(id, r, d);
        Audit("delete", "user", id.ToString(), new { via = "mcp", success = ok });
        return ok;
    }

    [McpServerTool(Name = "admin_list_departments")]
    public async Task<object> ListDepartments() => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _admin.ListDepartments();

    [McpServerTool(Name = "admin_create_department")]
    public async Task<object> CreateDepartment(string name, string description)
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        var dept = await _admin.CreateDepartment(name, description);
        Audit("create", "department", dept.Id.ToString(), new { via = "mcp", name });
        return dept;
    }

    [McpServerTool(Name = "admin_get_stats")]
    public async Task<object> GetStats() => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _admin.GetStats();
}
