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
        // DisplayName / StudentId / IdentityDisabled 必须一起返回：
        // 前端组织页用 displayName ?? username 渲染真名、用 studentId 展示学号、
        // 用 identityDisabled 标「已挂失」。此前只返回 Username，导致组织页永远显示
        // 登录名而不是真名，学号与挂失状态也一直不显示（用户反馈「名字没有显示真名」的根因）。
        return await query.OrderBy(u => u.Id).Select(u => new {
            u.Id, u.Username, u.DisplayName, u.StudentId, u.IdentityDisabled,
            u.Role, Department = u.Department != null ? u.Department.Name : null,
            u.DepartmentId, u.CreatedAt,
            InvitedBy = u.InvitedByUser != null ? u.InvitedByUser.Username : null
        }).ToListAsync<object>();
    }

    public async Task<User?> CreateUser(string username, string password, string userRole, int? deptId, string? currentRole, string? currentDept, string? studentId = null)
    {
        if (await _db.Users.AnyAsync(u => u.Username == username)) return null;
        studentId = string.IsNullOrWhiteSpace(studentId) ? null : studentId.Trim();
        if (studentId != null && await _db.Users.AnyAsync(u => u.StudentId == studentId)) return null;
        // Non-admin may not mint admin/部长 accounts (C-1 fix)
        if (currentRole != "admin" && (userRole == "admin" || userRole == "部长")) return null;
        if (currentRole == "部长" && !string.IsNullOrEmpty(currentDept))
        {
            var dept = await _db.Departments.FirstOrDefaultAsync(d => d.Name == currentDept);
            deptId = dept?.Id;
        }
        var user = new User { Username = username, PasswordHash = BCrypt.Net.BCrypt.HashPassword(password), Role = (userRole == "admin" || userRole == "部长") ? userRole : "member", Slug = Slug.NewUser(), DepartmentId = deptId, StudentId = studentId };
        _db.Users.Add(user); await _db.SaveChangesAsync();
        // 建用户时同步建空档案：管理端档案列表/详情依赖 PilotProfile 行存在
        _db.PilotProfiles.Add(new PilotProfile { UserId = user.Id });
        await _db.SaveChangesAsync();
        _log.Info("admin", $"User created: {username}");
        return user;
    }

    public async Task<bool> UpdateUser(int id, string? userRole, int? deptId, string? password, string? username,
        string? currentRole, string? currentDept, int currentUserId, string? studentId = null, bool? identityDisabled = null)
    {
        var user = await _db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return false;

        // 学号是设备认人的身份标识，修改仅 admin（防伪造认人链条）
        studentId = studentId == null ? null : (string.IsNullOrWhiteSpace(studentId) ? "" : studentId.Trim());
        if (studentId != null && currentRole != "admin") return false;
        // 身份挂失/解挂仅 admin（账号级封禁，部长不可挂失他人）
        if (identityDisabled.HasValue && currentRole != "admin") return false;

        // 部长在“本部门内”有限自主：可编辑本部门非 admin 成员的姓名/备注类字段。
        // 越权收口（安全审计发现的三条横向接管路径，一律仅 admin）：
        // ① 改部门——部长把自己调入他部门即获他部门管理权；
        // ② 改角色——部长可授予“部长”使权力自我增殖；
        // ③ 重置其他部长的密码——顶号接管同部门部长账号。
        if (currentRole != "admin")
        {
            if (user.Role == "admin") return false;                     // 不可操作 admin
            var actorSelf = currentUserId == id;
            var sameDept = user.Department?.Name == currentDept;
            if (!actorSelf && !sameDept) return false;                  // 部长只能动自己或本部门成员
            if (userRole is not null) return false;                     // 角色变更仅 admin
            if (deptId.HasValue) return false;                          // 部门变更仅 admin（防自调部门越权）
            if (!string.IsNullOrWhiteSpace(password) && user.Role == "部长" && !actorSelf)
                return false;                                           // 不可重置其他部长密码
        }

        var changes = new List<string>();
        if (!string.IsNullOrWhiteSpace(username) && user.Username != username)
        {
            if (await _db.Users.AnyAsync(u => u.Username == username)) return false; // 用户名已存在
            changes.Add($"username:{user.Username}→{username}"); user.Username = username;
        }
        if (userRole is not null && user.Role != userRole) { changes.Add($"role:{user.Role}→{userRole}"); user.Role = (userRole == "admin" || userRole == "部长") ? userRole : "member"; }
        if (studentId is not null && user.StudentId != (studentId == "" ? null : studentId))
        {
            if (studentId != "" && await _db.Users.AnyAsync(u => u.StudentId == studentId && u.Id != id)) return false; // 学号唯一
            changes.Add("studentId:set"); user.StudentId = studentId == "" ? null : studentId;
        }
        if (deptId.HasValue) { var newDept = deptId == 0 ? null : deptId; if (user.DepartmentId != newDept) { changes.Add($"dept:{user.DepartmentId}→{newDept}"); user.DepartmentId = newDept; } }
        if (!string.IsNullOrWhiteSpace(password)) { changes.Add("password:reset"); user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password); }
        if (identityDisabled.HasValue && user.IdentityDisabled != identityDisabled.Value)
        {
            changes.Add($"identity:{(identityDisabled.Value ? "挂失" : "解挂")}");
            user.IdentityDisabled = identityDisabled.Value;
            // 挂失时顺带自增 TokenVersion：已签发的 JWT 立即作废
            if (identityDisabled.Value) user.TokenVersion++;
        }

        // 角色 / 部门 / 密码变了 → 让已签发的 token 立即失效。
        // 否则被免职的部长、被换部门的人、被改密码的账号，旧 token 还会带着旧身份
        // 继续通过鉴权与授权策略校验，直到最长 7 天后自然过期。
        if (changes.Any(c => c.StartsWith("role:", StringComparison.Ordinal)
                          || c.StartsWith("dept:", StringComparison.Ordinal)
                          || c.StartsWith("password:", StringComparison.Ordinal)))
        {
            user.TokenVersion++;
            changes.Add("token:revoked");
        }

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
        // 有业务记录的成员不许物理删除（借还/领用/报损外键 Restrict，删了责任链就断）：
        // 离队场景应保留记录，只移除账号访问（改密码+降级或后续加停用标记）
        var hasBusiness =
            await _db.BatteryLoans.AnyAsync(l => l.UserId == id || l.ReturnedByUserId == id) ||
            await _db.CheckoutRequests.AnyAsync(c => c.RequesterUserId == id) ||
            await _db.DamageReports.AnyAsync(d => d.UserId == id);
        if (hasBusiness)
            throw new InvalidOperationException("该成员有借还/领用/报损记录，不能删除；请保留账号或改为停用");
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