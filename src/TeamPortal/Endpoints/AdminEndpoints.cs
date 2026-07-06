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
        var admin = app.MapGroup("/api/admin").RequireAuthorization("StaffOnly");

        // ── Stats ──
        admin.MapGet("/stats", async (AdminService svc) => Results.Ok(await svc.GetStats()));

        // ── Users ──
        admin.MapGet("/users", async (ClaimsPrincipal user, AdminService svc, AppDbContext db) =>
        {
            var (role, dept, id) = await GetUserCtx(user, db);
            return Results.Ok(await svc.ListUsers(role, dept, id));
        });

        admin.MapPost("/users", async (CreateUserReq req, ClaimsPrincipal user, AdminService svc, AppDbContext db, NotificationService notify) =>
        {
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("用户名和密码必填", statusCode: 400);
            var (role, dept, _) = await GetUserCtx(user, db);
            var u = await svc.CreateUser(req.Username, req.Password, req.Role ?? "member", req.DepartmentId, role, dept);
            if (u is not null) notify.Notify("新成员加入", $"{req.Username} 加入了团队", "/admin/users");
            return u is not null ? Results.Ok(u) : Results.Problem("用户名已存在", statusCode: 409);
        });

        admin.MapPut("/users/{id:int}", async (int id, UpdateUserReq req, ClaimsPrincipal user, AdminService svc, AppDbContext db, LogService log, NotificationService notify) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var ok = await svc.UpdateUser(id, req.Role, req.DepartmentId, req.Password, role, dept);
            if (ok)
            {
                var changes = new List<string>();
                if (req.Role is not null) changes.Add($"role→{req.Role}");
                if (req.DepartmentId.HasValue) changes.Add($"dept→{req.DepartmentId}");
                if (req.Password is not null) changes.Add("password-reset");
                log.Warn("admin", $"User #{id} updated by {actor}: {string.Join(", ", changes)}");
                notify.Notify("用户信息已更新", $"{actor} 修改了用户 #{id} 的信息", "/admin/users");
            }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("权限不足或用户不存在", statusCode: 404);
        });

        admin.MapDelete("/users/{id:int}", async (int id, ClaimsPrincipal user, AdminService svc, AppDbContext db, LogService log, NotificationService notify) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var ok = await svc.DeleteUser(id, role, dept);
            if (ok) { log.Warn("admin", $"User #{id} deleted by {actor}"); notify.Notify("用户已删除", $"{actor} 删除了用户 #{id}", "/admin/users"); }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("无法删除", statusCode: 400);
        });

        // ── Departments ──
        admin.MapGet("/departments", async (AdminService svc) => Results.Ok(await svc.ListDepartments()));

        admin.MapPost("/departments", async (CreateDeptReq req, AdminService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            var dept = await svc.CreateDepartment(req.Name, req.Description ?? "");
            var actor = user.Identity?.Name ?? "unknown";
            log.Info("admin", $"Department created: {dept.Name} by {actor}");
            notify.Notify("新部门创建", $"{actor} 创建了部门「{dept.Name}」", "/admin/departments");
            return Results.Ok(dept);
        });

        admin.MapPut("/departments/{id:int}", async (int id, UpdateDeptReq req, AdminService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            var ok = await svc.UpdateDepartment(id, req.Name, req.Description ?? "");
            if (ok) { var actor = user.Identity?.Name ?? "unknown"; log.Info("admin", $"Department #{id} updated: {req.Name} by {actor}"); notify.Notify("部门信息更新", $"{actor} 更新了部门信息", "/admin/departments"); }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("部门不存在", statusCode: 404);
        });

        admin.MapDelete("/departments/{id:int}", async (int id, AdminService svc, ClaimsPrincipal user, LogService log, NotificationService notify) =>
        {
            var actor = user.Identity?.Name ?? "unknown";
            var ok = await svc.DeleteDepartment(id);
            if (ok) { log.Warn("admin", $"Department #{id} deleted by {actor}"); notify.Notify("部门已删除", $"{actor} 删除了一个部门", "/admin/departments"); }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("部门不存在", statusCode: 404);
        });

        // ── Knowledge ──
        admin.MapPost("/knowledge/write", async (KnowledgeWriteReq req, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log, NotificationService notify) =>
        {
            req = req with { Path = Uri.UnescapeDataString(req.Path) };
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            if (!svc.CanAccess(req.Path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.WriteFile(req.Path, req.Content ?? ""); log.Info("knowledge", $"File written: {req.Path} by {actor}"); notify.Notify("知识库更新", $"{actor} 编辑了 {req.Path}", $"/knowledge/{req.Path.Replace(".md","")}"); return Results.Ok(new { success = true }); }
            catch (Exception e) { log.Error("knowledge", $"Write failed: {req.Path}", e.Message); return Results.Problem(e.Message, statusCode: 400); }
        });

        admin.MapDelete("/knowledge/delete", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log, NotificationService notify) =>
        {
            path = Uri.UnescapeDataString(path);
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.DeleteFile(path); log.Warn("knowledge", $"File deleted: {path} by {actor}"); notify.Notify("知识库文件已删除", $"{actor} 删除了 {path}"); return Results.Ok(new { success = true }); }
            catch (Exception e) { log.Error("knowledge", $"Delete failed: {path}", e.Message); return Results.Problem(e.Message, statusCode: 400); }
        });

        // ── Document upload ──
        admin.MapPost("/documents/upload", async (IFormFile file, string? folder, ClaimsPrincipal user, DocumentService docSvc, AppDbContext db, BaiduNetdiskService baidu, LogService log, NotificationService notify) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file provided", statusCode: 400);
            if (file.Length > 50 * 1024 * 1024) return Results.Problem("File too large (max 50MB)", statusCode: 400);
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var targetFolder = folder ?? "公共";

            var tmpPath = Path.GetTempFileName();
            await using (var fs = File.Create(tmpPath))
                await file.CopyToAsync(fs);

            try
            {
                using var stream2 = File.OpenRead(tmpPath);
                var formFile = new FormFile(stream2, 0, file.Length, file.Name, file.FileName)
                {
                    Headers = file.Headers,
                    ContentType = file.ContentType
                };
                var path = await docSvc.UploadAndProcess(formFile, targetFolder, role, dept);
                log.Info("knowledge", $"Document uploaded: {file.FileName} ({file.Length} bytes) → {path} by {actor}");

                string? cloudUrl = null;
                if (await baidu.IsConfigured())
                {
                    try
                    {
                        var remotePath = $"{BaiduNetdiskService.RootDir}/user-data/documents/{file.FileName}";
                        await baidu.UploadFile(tmpPath, remotePath);
                        cloudUrl = $"/api/baidu/view-by-path?path={Uri.EscapeDataString(remotePath)}";
                        log.Info("baidu", $"Document synced to cloud: {remotePath}");
                    }
                    catch (Exception ex) { log.Warn("baidu", $"Document cloud sync failed: {file.FileName} — {ex.Message}"); }
                }

                notify.Notify("文档上传完成", $"{actor} 上传了 {file.FileName} 到 {targetFolder}", $"/knowledge/{path.Replace(".md","")}");
                return Results.Ok(new { success = true, path, cloudUrl });
            }
            catch (UnauthorizedAccessException) { return Results.Problem("Access denied", statusCode: 403); }
            catch (Exception e) { log.Error("knowledge", $"Document upload failed: {file.FileName}", e.Message); return Results.Problem(e.Message, statusCode: 500); }
            finally { if (File.Exists(tmpPath)) File.Delete(tmpPath); }
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
