using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class AdminService
{
    private readonly AppDbContext _db;

    public AdminService(AppDbContext db) { _db = db; }

    // ── Users ──
    public async Task<List<object>> ListUsers()
    {
        return await _db.Users.Include(u => u.Department).OrderBy(u => u.Id).Select(u => new
        {
            u.Id, u.Username, u.Role, Department = u.Department != null ? u.Department.Name : null,
            u.DepartmentId, u.CreatedAt
        }).ToListAsync<object>();
    }

    public async Task<User?> CreateUser(string username, string password, string role, int? deptId)
    {
        if (await _db.Users.AnyAsync(u => u.Username == username)) return null;
        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = (role == "admin" || role == "部长") ? role : "member",
            DepartmentId = deptId
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<bool> UpdateUser(int id, string? role, int? deptId, string? password)
    {
        var user = await _db.Users.FindAsync(id);
        if (user is null) return false;
        if (role is not null) user.Role = role;
        if (deptId.HasValue) user.DepartmentId = deptId == 0 ? null : deptId;
        if (!string.IsNullOrWhiteSpace(password)) user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteUser(int id)
    {
        var user = await _db.Users.FindAsync(id);
        if (user is null || user.Role == "admin" || user.Role == "部长") return false;
        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return true;
    }

    // ── Departments ──
    public async Task<List<Department>> ListDepartments() => await _db.Departments.OrderBy(d => d.Name).ToListAsync();

    public async Task<Department> CreateDepartment(string name, string description)
    {
        var dept = new Department { Name = name, Description = description };
        _db.Departments.Add(dept);
        await _db.SaveChangesAsync();
        return dept;
    }

    public async Task<bool> UpdateDepartment(int id, string name, string description)
    {
        var dept = await _db.Departments.FindAsync(id);
        if (dept is null) return false;
        dept.Name = name; dept.Description = description;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteDepartment(int id)
    {
        var dept = await _db.Departments.FindAsync(id);
        if (dept is null) return false;
        await _db.Users.Where(u => u.DepartmentId == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.DepartmentId, (int?)null));
        _db.Departments.Remove(dept);
        await _db.SaveChangesAsync();
        return true;
    }

    // ── Stats ──
    public async Task<object> GetStats()
    {
        return new
        {
            userCount = await _db.Users.CountAsync(),
            inventoryCount = await _db.InventoryItems.CountAsync(),
            inventoryTotal = await _db.InventoryItems.SumAsync(i => i.Quantity),
            departmentCount = await _db.Departments.CountAsync(),
        };
    }
}
