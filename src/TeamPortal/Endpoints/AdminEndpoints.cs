using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin").RequireAuthorization();

        // ── Stats ──
        admin.MapGet("/stats", async (AdminService svc) => Results.Ok(await svc.GetStats()));

        // ── Users ──
        admin.MapGet("/users", async (AdminService svc) => Results.Ok(await svc.ListUsers()));

        admin.MapPost("/users", async (CreateUserReq req, AdminService svc) =>
        {
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("用户名和密码必填", statusCode: 400);
            var user = await svc.CreateUser(req.Username, req.Password, req.Role ?? "member", req.DepartmentId);
            return user is not null ? Results.Ok(user) : Results.Problem("用户名已存在", statusCode: 409);
        });

        admin.MapPut("/users/{id:int}", async (int id, UpdateUserReq req, AdminService svc) =>
        {
            var ok = await svc.UpdateUser(id, req.Role, req.DepartmentId, req.Password);
            return ok ? Results.Ok(new { success = true }) : Results.Problem("用户不存在", statusCode: 404);
        });

        admin.MapDelete("/users/{id:int}", async (int id, AdminService svc) =>
        {
            var ok = await svc.DeleteUser(id);
            return ok ? Results.Ok(new { success = true }) : Results.Problem("无法删除管理员或用户不存在", statusCode: 400);
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

        // ── Knowledge file management ──
        admin.MapPost("/knowledge/write", (string path, string content, KnowledgeService svc) =>
        {
            try { svc.WriteFile(path, content); return Results.Ok(new { success = true }); }
            catch (Exception e) { return Results.Problem(e.Message, statusCode: 400); }
        });

        admin.MapDelete("/knowledge/delete", (string path, KnowledgeService svc) =>
        {
            try { svc.DeleteFile(path); return Results.Ok(new { success = true }); }
            catch (Exception e) { return Results.Problem(e.Message, statusCode: 400); }
        });
    }
}

public record CreateUserReq(string Username, string Password, string? Role, int? DepartmentId);
public record UpdateUserReq(string? Role, int? DepartmentId, string? Password);
public record CreateDeptReq(string Name, string? Description);
public record UpdateDeptReq(string Name, string? Description);
