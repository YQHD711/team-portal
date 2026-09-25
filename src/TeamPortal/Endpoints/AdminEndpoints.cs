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
        // Stats — staff only (admin & 部长), same policy as the rest of /api/admin
        app.MapGet("/api/admin/stats", async (AdminService svc) => Results.Ok(await svc.GetStats())).RequireAuthorization("StaffOnly");

        var admin = app.MapGroup("/api/admin").RequireAuthorization("StaffOnly");

        // ── Users ──
        admin.MapGet("/users", async (ClaimsPrincipal user, AdminService svc, AppDbContext db) =>
        {
            var (role, dept, id) = await GetUserCtx(user, db);
            return Results.Ok(await svc.ListUsers(role, dept, id));
        });

        // POST /api/admin/users — AdminOnly (C-1 fix: previously StaffOnly let 部长 mint admin/部长 accounts)
        admin.MapPost("/users", async (CreateUserReq req, ClaimsPrincipal user, AdminService svc, AppDbContext db, NotificationService notify, LogService log, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("用户名和密码必填", statusCode: 400);
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var u = await svc.CreateUser(req.Username, req.Password, req.Role ?? "member", req.DepartmentId, role, dept);
            if (u is not null)
            {
                log.Audit("create", actor, targetType: "user", targetId: u.Id.ToString(),
                    data: new { username = req.Username, role = req.Role ?? "member", departmentId = req.DepartmentId }, ipAddress: LogService.ClientIp(ctx));
                notify.Notify("新成员加入", $"{req.Username} 加入了团队", "/admin/organization", targetRole: "staff");
            }
            else
            {
                log.Audit("create", actor, targetType: "user",
                    data: new { username = req.Username, success = false, error = "用户名已存在或权限不足" }, ipAddress: LogService.ClientIp(ctx));
            }
            return u is not null ? Results.Ok(u) : Results.Problem("用户名已存在或权限不足", statusCode: 400);
        }).RequireAuthorization("AdminOnly");

        admin.MapPut("/users/{id:int}", async (int id, UpdateUserReq req, ClaimsPrincipal user, AdminService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var (role, dept, actorId) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var ok = await svc.UpdateUser(id, req.Role, req.DepartmentId, req.Password, req.Username, role, dept, actorId);
            if (ok)
            {
                var changes = new List<string>();
                if (req.Username is not null) changes.Add($"username→{req.Username}");
                if (req.Role is not null) changes.Add($"role→{req.Role}");
                if (req.DepartmentId.HasValue) changes.Add($"dept→{req.DepartmentId}");
                if (req.Password is not null) changes.Add("password-reset");
                log.Warn("admin", $"User #{id} updated by {actor}: {string.Join(", ", changes)}");
                log.Audit("update", actor, targetType: "user", targetId: id.ToString(),
                    data: new { changes }, ipAddress: LogService.ClientIp(ctx));
                notify.Notify("用户信息已更新", $"{actor} 修改了用户 #{id} 的信息", "/admin/organization", targetRole: "staff");
            }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("权限不足或用户不存在", statusCode: 404);
        });

        admin.MapDelete("/users/{id:int}", async (int id, ClaimsPrincipal user, AdminService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var ok = await svc.DeleteUser(id, role, dept);
            if (ok)
            {
                log.Warn("admin", $"User #{id} deleted by {actor}");
                log.Audit("delete", actor, targetType: "user", targetId: id.ToString(),
                    data: new { success = true }, ipAddress: LogService.ClientIp(ctx));
                notify.Notify("用户已删除", $"{actor} 删除了用户 #{id}", "/admin/organization", targetRole: "staff");
            }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("无法删除", statusCode: 400);
        }).RequireAuthorization("AdminOnly");

        // ── Departments ──
        admin.MapGet("/departments", async (AdminService svc) => Results.Ok(await svc.ListDepartments()));

        admin.MapPost("/departments", async (CreateDeptReq req, AdminService svc, ClaimsPrincipal user, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var dept = await svc.CreateDepartment(req.Name, req.Description ?? "");
            var actor = user.Identity?.Name ?? "unknown";
            log.Info("admin", $"Department created: {dept.Name} by {actor}");
            log.Audit("create", actor, targetType: "department", targetId: dept.Id.ToString(),
                data: new { name = req.Name }, ipAddress: LogService.ClientIp(ctx));
            notify.Notify("新部门创建", $"{actor} 创建了部门「{dept.Name}」", "/admin/organization", targetRole: "staff");
            return Results.Ok(dept);
        }).RequireAuthorization("AdminOnly");

        admin.MapPut("/departments/{id:int}", async (int id, UpdateDeptReq req, AdminService svc, ClaimsPrincipal user, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var ok = await svc.UpdateDepartment(id, req.Name, req.Description ?? "");
            if (ok)
            {
                var actor = user.Identity?.Name ?? "unknown";
                log.Info("admin", $"Department #{id} updated: {req.Name} by {actor}");
                log.Audit("update", actor, targetType: "department", targetId: id.ToString(),
                    data: new { name = req.Name }, ipAddress: LogService.ClientIp(ctx));
                notify.Notify("部门信息更新", $"{actor} 更新了部门信息", "/admin/organization", targetRole: "staff");
            }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("部门不存在", statusCode: 404);
        }).RequireAuthorization("AdminOnly");

        admin.MapDelete("/departments/{id:int}", async (int id, AdminService svc, ClaimsPrincipal user, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            var actor = user.Identity?.Name ?? "unknown";
            var ok = await svc.DeleteDepartment(id);
            if (ok)
            {
                log.Warn("admin", $"Department #{id} deleted by {actor}");
                log.Audit("delete", actor, targetType: "department", targetId: id.ToString(),
                    data: new { success = true }, ipAddress: LogService.ClientIp(ctx));
                notify.Notify("部门已删除", $"{actor} 删除了一个部门", "/admin/organization", targetRole: "staff");
            }
            return ok ? Results.Ok(new { success = true }) : Results.Problem("部门不存在", statusCode: 404);
        }).RequireAuthorization("AdminOnly");

        // ── Knowledge ──
        // 图片上传：文档里的 `![](图.png)` 需要一张真图存进知识库。
        // 不能走 /documents/upload —— 那条路会把非 txt/md 一律当文档解析成 .md。
        admin.MapPost("/knowledge/asset", async (IFormFile file, string? dir, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file provided", statusCode: 400);
            if (file.Length > MaxImageBytes) return Results.Problem($"图片过大（上限 {MaxImageBytes / 1024 / 1024}MB）", statusCode: 400);

            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            var folder = (dir ?? "公共").Replace('\\', '/').Trim().Trim('/');
            // 目录名即权限：用「目录 + 探针文件名」过一遍与写入完全相同的 ACL
            if (folder.Length == 0 || !svc.CanAccess($"{folder}/probe.png", role, dept))
                return Results.Problem("Access denied", statusCode: 403);

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!ImageExtensions.Contains(ext))
                return Results.Problem($"不支持的图片格式 {ext}（支持 png/jpg/jpeg/gif/webp）", statusCode: 400);

            var stem = SanitizeStem(file.FileName);
            var relative = $"{folder}/{stem}{ext}";
            for (var i = 1; svc.FileExists(relative) && i < 100; i++)
                relative = $"{folder}/{stem}-{i}{ext}";

            try
            {
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms, ctx.RequestAborted);
                svc.WriteFile(relative, ms.ToArray());
                log.Info("knowledge", $"Image uploaded: {file.FileName} ({file.Length} bytes) → {relative} by {actor}");
                log.Audit("upload", actor, targetType: "knowledge-image", targetId: relative,
                    data: new { name = file.FileName, size = file.Length }, ipAddress: LogService.ClientIp(ctx));
                return Results.Ok(new { path = relative });
            }
            catch (Exception e)
            {
                log.Error("knowledge", $"Image upload failed: {file.FileName}", e.Message);
                return Results.Problem(WriteErrorHint(e), statusCode: 400);
            }
        }).DisableAntiforgery();

        admin.MapPost("/knowledge/write", async (KnowledgeWriteReq req, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            req = req with { Path = Uri.UnescapeDataString(req.Path) };
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            if (!svc.CanAccess(req.Path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.WriteFile(req.Path, req.Content ?? ""); log.Info("knowledge", $"File written: {req.Path} by {actor}"); log.Audit("update", actor, targetType: "knowledge", targetId: req.Path, data: new { success = true }, ipAddress: LogService.ClientIp(ctx)); notify.Notify("知识库更新", $"{actor} 编辑了 {req.Path}", $"/knowledge/{req.Path.Replace(".md","")}", targetRole: "staff"); return Results.Ok(new { success = true }); }
            catch (Exception e) { log.Error("knowledge", $"Write failed: {req.Path}", e.Message); log.Audit("update", actor, targetType: "knowledge", targetId: req.Path, data: new { success = false, error = e.Message }, ipAddress: LogService.ClientIp(ctx)); return Results.Problem(WriteErrorHint(e), statusCode: 400); }
        });

        admin.MapDelete("/knowledge/delete", async (string path, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            path = Uri.UnescapeDataString(path);
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            if (!svc.CanAccess(path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.DeleteFile(path); log.Warn("knowledge", $"File deleted: {path} by {actor}"); log.Audit("delete", actor, targetType: "knowledge", targetId: path, data: new { success = true }, ipAddress: LogService.ClientIp(ctx)); notify.Notify("知识库文件已删除", $"{actor} 删除了 {path}", targetRole: "staff"); return Results.Ok(new { success = true }); }
            catch (Exception e) { log.Error("knowledge", $"Delete failed: {path}", e.Message); log.Audit("delete", actor, targetType: "knowledge", targetId: path, data: new { success = false, error = e.Message }, ipAddress: LogService.ClientIp(ctx)); return Results.Problem(e.Message, statusCode: 400); }
        });

        admin.MapPost("/knowledge/rename", async (RenameKnowledgeReq req, ClaimsPrincipal user, KnowledgeService svc, AppDbContext db, LogService log, NotificationService notify, HttpContext ctx) =>
        {
            req = req with { Path = Uri.UnescapeDataString(req.Path), NewPath = Uri.UnescapeDataString(req.NewPath) };
            var (role, dept, _) = await GetUserCtx(user, db);
            var actor = user.Identity?.Name ?? "unknown";
            if (!svc.CanAccess(req.Path, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            // 目标路径同样要过 ACL:否则可以把公共文档"改名"进他部门目录(等于越权写入)
            if (!svc.CanAccess(req.NewPath, role, dept)) return Results.Problem("Access denied", statusCode: 403);
            try { svc.Rename(req.Path, req.NewPath); log.Info("knowledge", $"Renamed: {req.Path} → {req.NewPath} by {actor}"); log.Audit("update", actor, targetType: "knowledge", targetId: req.Path, data: new { newPath = req.NewPath }, ipAddress: LogService.ClientIp(ctx)); notify.Notify("知识库重命名", $"{actor} 将 {req.Path} 重命名为 {req.NewPath}", targetRole: "staff"); return Results.Ok(new { success = true }); }
            catch (Exception e) { log.Error("knowledge", $"Rename failed: {req.Path}", e.Message); return Results.Problem(e.Message, statusCode: 400); }
        });

        // ── Document upload ──
        admin.MapPost("/documents/upload", async (IFormFile file, string? folder, ClaimsPrincipal user, DocumentService docSvc, AppDbContext db, BaiduNetdiskService baidu, LogService log, NotificationService notify, HttpContext ctx) =>
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
                log.Audit("upload", actor, targetType: "document", data: new { name = file.FileName, size = file.Length, path, folder = targetFolder },
                    ipAddress: LogService.ClientIp(ctx));

                string? cloudUrl = null;
                if (await baidu.IsConfigured())
                {
                    try
                    {
                        var remotePath = $"{BaiduNetdiskService.RootDir}/user-data/documents/{file.FileName}";
                        await baidu.UploadFile(tmpPath, remotePath, null, ctx.RequestAborted);
                        cloudUrl = $"/api/baidu/view-by-path?path={Uri.EscapeDataString(remotePath)}";
                        log.Info("baidu", $"Document synced to cloud: {remotePath}");
                    }
                    catch (Exception ex) { log.Warn("baidu", $"Document cloud sync failed: {file.FileName} — {ex.Message}"); }
                }

                notify.Notify("文档上传完成", $"{actor} 上传了 {file.FileName} 到 {targetFolder}", $"/knowledge/{path.Replace(".md","")}", targetRole: "staff");
                return Results.Ok(new { success = true, path, cloudUrl });
            }
            catch (DocumentConflictException e) { return Results.Problem(e.Message, statusCode: 409); }
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

    /// <summary>
    /// 把知识库写入失败翻译成**能直接照做**的提示。
    ///
    /// 起因：用户保存时报 400，而前端只显示"保存失败"，看不到任何原因。
    /// 最常见的真实原因是属主对不上 —— 后端容器以非 root 的 app 用户运行，
    /// 若有人（例如外部 agent）直接在宿主机上往 data/knowledge 里写文件，
    /// 那些目录会属于 root，app 用户建不了临时文件，于是"能读不能写"。
    /// </summary>
    /// <summary>知识库图片上限：文档配图不需要更大，也避免一次请求把内存吃满。</summary>
    private const long MaxImageBytes = 10 * 1024 * 1024;

    private static readonly HashSet<string> ImageExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".gif", ".webp" };

    /// <summary>
    /// 图片文件名净化：去掉目录部分与扩展名，只留中英文数字和 -_，空则回退 "image"。
    /// 结果会直接拼进知识库相对路径，所以不能放过 `/`、`..` 之类。
    /// </summary>
    internal static string SanitizeStem(string? fileName)
    {
        var name = (fileName ?? "").Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..];
        name = Path.GetFileNameWithoutExtension(name);
        var kept = new string(name.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ' ').ToArray()).Trim();
        kept = kept.Replace(' ', '-');
        if (kept.Length > 60) kept = kept[..60];
        return kept.Length > 0 ? kept : "image";
    }

    internal static string WriteErrorHint(Exception e) => e switch    {
        UnauthorizedAccessException => $"没有写入权限：{e.Message}\n"
            + "该文件/目录的属主与本服务不一致（常见于直接用宿主机工具写入 data/knowledge）。"
            + "在服务器上执行：sudo chown -R $(docker exec teamportal-backend-1 id -u):$(docker exec teamportal-backend-1 id -g) <部署目录>/data/knowledge",
        IOException io when io.Message.Contains("space", StringComparison.OrdinalIgnoreCase)
            => $"磁盘空间不足：{io.Message}\n请清理服务器磁盘后重试。",
        _ => e.Message,
    };
}

public record CreateUserReq(string Username, string Password, string? Role, int? DepartmentId);
public record UpdateUserReq(string? Role, int? DepartmentId, string? Password, string? Username = null);
public record CreateDeptReq(string Name, string? Description);
public record UpdateDeptReq(string Name, string? Description);
public record KnowledgeWriteReq(string Path, string? Content);
public record RenameKnowledgeReq(string Path, string NewPath);
