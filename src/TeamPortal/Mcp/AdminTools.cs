using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 账号/部门管理工具。策略对齐 HTTP 侧: /api/admin 组为 StaffOnly,
/// 其中删除用户、新建部门为 AdminOnly(AdminEndpoints 的 MapPost/MapDelete 显式收紧)。
/// </summary>
[McpServerToolType]
public class AdminTools
{
    private readonly AdminService _admin;
    private readonly IHttpContextAccessor _http;
    public AdminTools(AdminService admin, IHttpContextAccessor http) { _admin = admin; _http = http; }

    private (string? role, string? dept, int uid) GetUser() => (McpAuth.Role(_http), McpAuth.Department(_http), McpAuth.UserId(_http));

    [McpServerTool(Name = "admin_list_users")]
    public async Task<object> ListUsers(string? role = null, string? dept = null) { var (r, d, i) = GetUser(); if (r != "admin" && r != "部长") return McpAuth.Forbidden; return await _admin.ListUsers(role ?? r, dept ?? d, i); }
    [McpServerTool(Name = "admin_create_user")]
    public async Task<object?> CreateUser(string username, string password, string userRole = "member", int? deptId = null) { var (r, d, _) = GetUser(); if (r != "admin" && r != "部长") return McpAuth.Forbidden; return await _admin.CreateUser(username, password, userRole, deptId, r, d); }
    [McpServerTool(Name = "admin_update_user")]
    public async Task<bool> UpdateUser(int id, string? userRole = null, int? deptId = null, string? password = null) { var (r, d, u) = GetUser(); if (r != "admin" && r != "部长") return false; return await _admin.UpdateUser(id, userRole, deptId, password, null, r, d, u); }
    [McpServerTool(Name = "admin_delete_user")]
    public async Task<bool> DeleteUser(int id) { var (r, d, _) = GetUser(); if (r != "admin") return false; return await _admin.DeleteUser(id, r, d); }
    [McpServerTool(Name = "admin_list_departments")]
    public async Task<object> ListDepartments() => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _admin.ListDepartments();
    [McpServerTool(Name = "admin_create_department")]
    public async Task<object> CreateDepartment(string name, string description) => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _admin.CreateDepartment(name, description);
    [McpServerTool(Name = "admin_get_stats")]
    public async Task<object> GetStats() => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _admin.GetStats();
}
