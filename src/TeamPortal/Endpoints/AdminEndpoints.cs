using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class AdminEndpoints
{
    private static async Task<(string? role, string? dept, int id)> GetUserCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null, 0);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null, 0) : (u.Role, u.Department?.Name, u.Id);
    }

    public static void MapAdminEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin").RequireAuthorization();

        // ── Stats ──
        admin.MapGet("/stats", async (AdminService svc) => Results.Ok(await svc.GetStats()));

        // ── Users ──
        admin.MapGet("/users", async (ClaimsPrincipal user, AdminService svc, AppDbContext db) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            return Results.Ok(await svc.ListUsers(role, dept));
        });

        admin.MapPost("/users", async (CreateUserReq req, ClaimsPrincipal user, AdminService svc, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("用户名和密码必填", statusCode: 400);
            var (role, dept, _) = await GetUserCtx(user, db);
            var u = await svc.CreateUser(req.Username, req.Password, req.Role ?? "member", req.DepartmentId, role, dept);
            return u is not null ? Results.Ok(u) : Results.Problem("用户名已存在", statusCode: 409);
        });

        admin.MapPut("/users/{id:int}", async (int id, UpdateUserReq req, ClaimsPrincipal user, AdminService svc, AppDbContext db) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            var ok = await svc.UpdateUser(id, req.Role, req.DepartmentId, req.Password, role, dept);
            return ok ? Results.Ok(new { success = true }) : Results.Problem("权限不足或用户不存在", statusCode: 404);
        });

        admin.MapDelete("/users/{id:int}", async (int id, ClaimsPrincipal user, AdminService svc, AppDbContext db) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            var ok = await svc.DeleteUser(id, role, dept);
            return ok ? Results.Ok(new { success = true }) : Results.Problem("无法删除", statusCode: 400);
        });

        // ── Departments ──
        admin.MapGet("/departments", async (AdminService svc) => Results.Ok(await svc.ListDepartments()));

        admin.MapPost("/departments", async (CreateDeptReq req, AdminService svc) =>
        {
            var dept = await svc.CreateDepartment(req.Name, req.Description ?? "");
            return Results.Ok(dept);
        });

        admin.MapPut("/departments/{id:int}", async (int id, UpdateDeptReq req, AdminService svc) =>
        {
            var ok = await svc.UpdateDepartment(id, req.Name, req.Description ?? "");
            return ok ? Results.Ok(new { success = true }) : Results.Problem("部门不存在", statusCode: 404);
        });

        admin.MapDelete("/departments/{id:int}", async (int id, AdminService svc) =>
        {
            var ok = await svc.DeleteDepartment(id);
            return ok ? Results.Ok(new { success = true }) : Results.Problem("部门不存在", statusCode: 404);
        });

        // ── Knowledge ──
        admin.MapPost("/knowledge/write", async (KnowledgeWriteReq req, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            if (!svc.CanAccess(req.Path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.WriteFile(req.Path, req.Content ?? ""); return Results.Ok(new { success = true }); }
            catch (Exception e) { return Results.Problem(e.Message, statusCode: 400); }
        });

        admin.MapDelete("/knowledge/delete", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.DeleteFile(path); return Results.Ok(new { success = true }); }
            catch (Exception e) { return Results.Problem(e.Message, statusCode: 400); }
        });

        // ── Document upload ──
        admin.MapPost("/documents/upload", async (IFormFile file, string? folder, ClaimsPrincipal user, DocumentService docSvc, AppDbContext db) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file provided", statusCode: 400);
            if (file.Length > 50 * 1024 * 1024) return Results.Problem("File too large (max 50MB)", statusCode: 400);
            var (role, dept, _) = await GetUserCtx(user, db);
            var targetFolder = folder ?? "公共";
            try
            {
                var path = await docSvc.UploadAndProcess(file, targetFolder, role, dept);
                return Results.Ok(new { success = true, path });
            }
            catch (UnauthorizedAccessException) { return Results.Problem("Access denied", statusCode: 403); }
            catch (Exception e) { return Results.Problem(e.Message, statusCode: 500); }
        }).DisableAntiforgery();

        // ── User info (for sidebar) ──
        admin.MapGet("/me", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            return Results.Ok(new { role, department = dept });
        });
    }
}

public record CreateUserReq(string Username, string Password, string? Role, int? DepartmentId);
public record UpdateUserReq(string? Role, int? DepartmentId, string? Password);
public record CreateDeptReq(string Name, string? Description);
public record UpdateDeptReq(string Name, string? Description);
public record KnowledgeWriteReq(string Path, string? Content);
