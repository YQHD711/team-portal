using System.Security.Claims;
using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class AdminTools
{
    private readonly AdminService _admin;
    private readonly IHttpContextAccessor _http;
    public AdminTools(AdminService admin, IHttpContextAccessor http) { _admin = admin; _http = http; }

    private (string? role, string? dept, int uid) GetUser()
    {
        var u = _http.HttpContext?.User;
        return (u?.FindFirst(ClaimTypes.Role)?.Value, u?.FindFirst("Department")?.Value, int.TryParse(u?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : 0);
    }

    [McpServerTool(Name = "admin_list_users")]
    public async Task<object> ListUsers(string? role = null, string? dept = null) { var (r, d, i) = GetUser(); if (r != "admin" && r != "部长") return "Forbidden"; return await _admin.ListUsers(role ?? r, dept ?? d, i); }
    [McpServerTool(Name = "admin_create_user")]
    public async Task<object?> CreateUser(string username, string password, string userRole = "member", int? deptId = null) { var (r, d, _) = GetUser(); if (r != "admin" && r != "部长") return "Forbidden"; return await _admin.CreateUser(username, password, userRole, deptId, r, d); }
    [McpServerTool(Name = "admin_update_user")]
    public async Task<bool> UpdateUser(int id, string? userRole = null, int? deptId = null, string? password = null) { var (r, d, _) = GetUser(); if (r != "admin" && r != "部长") return false; return await _admin.UpdateUser(id, userRole, deptId, password, null, r, d); }
    [McpServerTool(Name = "admin_delete_user")]
    public async Task<bool> DeleteUser(int id) { var (r, d, _) = GetUser(); if (r != "admin") return false; return await _admin.DeleteUser(id, r, d); }
    [McpServerTool(Name = "admin_list_departments")]
    public async Task<object> ListDepartments() => await _admin.ListDepartments();
    [McpServerTool(Name = "admin_create_department")]
    public async Task<object> CreateDepartment(string name, string description) => await _admin.CreateDepartment(name, description);
    [McpServerTool(Name = "admin_get_stats")]
    public async Task<object> GetStats() => await _admin.GetStats();
}
