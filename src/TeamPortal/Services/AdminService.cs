using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class AdminService
{
    private readonly AppDbContext _db;
    private readonly KnowledgeService _knowledge;
    private readonly LogService _log;

    public AdminService(AppDbContext db, KnowledgeService knowledge, LogService log) { _db = db; _knowledge = knowledge; _log = log; }

    // ── Helpers ──
    public async Task<(string? role, string? dept)> GetUserInfo(int userId)
    {
        var u = await _db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == userId);
        return u is null ? (null, null) : (u.Role, u.Department?.Name);
    }

    // ── Users ──
    public async Task<List<object>> ListUsers(string? role, string? dept, int userId)
    {
        var query = _db.Users.Include(u => u.Department).AsQueryable();
        if (role == "部长") query = query.Where(u => u.Department!.Name == dept || u.Id == userId);
        return await query.OrderBy(u => u.Id).Select(u => new {
            u.Id, u.Username, u.Role, Department = u.Department != null ? u.Department.Name : null,
            u.DepartmentId, u.CreatedAt,
            InvitedBy = u.InvitedByUser != null ? u.InvitedByUser.Username : null
        }).ToListAsync<object>();
    }

    public async Task<User?> CreateUser(string username, string password, string userRole, int? deptId, string? currentRole, string? currentDept)
    {
        if (await _db.Users.AnyAsync(u => u.Username == username)) return null;
        // Non-admin may not mint admin/部长 accounts (C-1 fix)
        if (currentRole != "admin" && (userRole == "admin" || userRole == "部长")) return null;
        if (currentRole == "部长" && !string.IsNullOrEmpty(currentDept))
        {
            var dept = await _db.Departments.FirstOrDefaultAsync(d => d.Name == currentDept);
            deptId = dept?.Id;
        }
        var user = new User { Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword(password), Role = (userRole == "admin" || userRole == "部长") ? userRole : "member", DepartmentId = deptId };
        _db.Users.Add(user); await _db.SaveChangesAsync();
        _log.Info("admin", $"User created: {username}");
        return user;
    }

    public async Task<bool> UpdateUser(int id, string? userRole, int? deptId, string? password, string? username,
        string? currentRole, string? currentDept, int currentUserId)
    {
        var user = await _db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return false;

        // 部长在“本部门内”最大自主:可编辑自己或本部门任意非 admin(含同部门其他部长、可授予部长、可调部门);
        // 但永不触碰 admin,永不授予 admin,不能编辑他部门成员。
        if (currentRole != "admin")
        {
            if (user.Role == "admin") return false;                     // 不可操作 admin
            var actorSelf = currentUserId == id;
            var sameDept = user.Department?.Name == currentDept;
            if (!actorSelf && !sameDept) return false;                  // 部长只能动自己或本部门成员
            if (userRole is not null && userRole == "admin") return false; // 不可授予 admin
        }

        var changes = new List<string>();
        if (!string.IsNullOrWhiteSpace(username) && user.Username != username)
        {
            if (await _db.Users.AnyAsync(u => u.Username == username)) return false; // 用户名已存在
            changes.Add($"username:{user.Username}→{username}"); user.Username = username;
        }
        if (userRole is not null && user.Role != userRole) { changes.Add($"role:{user.Role}→{userRole}"); user.Role = (userRole == "admin" || userRole == "部长") ? userRole : "member"; }
        if (deptId.HasValue) { var newDept = deptId == 0 ? null : deptId; if (user.DepartmentId != newDept) { changes.Add($"dept:{user.DepartmentId}→{newDept}"); user.DepartmentId = newDept; } }
        if (!string.IsNullOrWhiteSpace(password)) { changes.Add("password:reset"); user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password); }
        await _db.SaveChangesAsync();

        if (changes.Count > 0)
            _log.Info("admin", $"User updated: {user.Username}", $"{{\"changes\":\"{string.Join(",", changes)}\"}}", user.Username);
        return true;
    }

    public async Task<bool> DeleteUser(int id, string? currentRole, string? currentDept)
    {
        var user = await _db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == id);
        if (user is null || user.Role == "admin" || user.Role == "部长") return false;
        if (currentRole == "部长" && user.Department?.Name != currentDept) return false;
        _db.Users.Remove(user); await _db.SaveChangesAsync();
        _log.Warn("admin", $"User deleted: {user.Username}", $"{{\"role\":\"{user.Role}\"}}");
        return true;
    }

    // ── Departments ──
    public async Task<List<Department>> ListDepartments() => await _db.Departments.OrderBy(d => d.Name).ToListAsync();

    public async Task<Department> CreateDepartment(string name, string description)
    {
        var dept = new Department { Name = name, Description = description };
        _db.Departments.Add(dept); await _db.SaveChangesAsync();
        _knowledge.CreateDepartmentFolder(name);
        _log.Info("admin", $"Department created: {name}", $"{{\"desc\":\"{description}\"}}");
        return dept;
    }

    public async Task<bool> UpdateDepartment(int id, string name, string description)
    {
        var dept = await _db.Departments.FindAsync(id);
        if (dept is null) return false;
        var oldName = dept.Name;
        dept.Name = name; dept.Description = description;
        await _db.SaveChangesAsync();
        _log.Info("admin", $"Department updated: {oldName}→{name}");
        return true;
    }

    public async Task<bool> DeleteDepartment(int id)
    {
        var dept = await _db.Departments.FindAsync(id);
        if (dept is null) return false;
        await _db.Users.Where(u => u.DepartmentId == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.DepartmentId, (int?)null));
        _db.Departments.Remove(dept); await _db.SaveChangesAsync();
        _log.Warn("admin", $"Department deleted: {dept.Name}");
        return true;
    }

    // ── Stats ──
    public async Task<object> GetStats() => new {
        userCount = await _db.Users.CountAsync(), inventoryCount = await _db.InventoryItems.CountAsync(),
        inventoryTotal = await _db.InventoryItems.SumAsync(i => i.Quantity), departmentCount = await _db.Departments.CountAsync()
    };
}
