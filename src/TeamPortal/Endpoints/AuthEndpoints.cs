using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/register", async (RegisterRequest? req, AuthService auth, NotificationService notify, LogService log, HttpContext ctx) =>
        {
            if (req is null)
                return Results.Problem("请求体不能为空", statusCode: 400);

            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("Username and password are required", statusCode: 400);

            if (req.Username.Trim().Length < 2)
                return Results.Problem("用户名至少需要2个字符", statusCode: 400);

            if (req.Password.Length < 6)
                return Results.Problem("Password must be at least 6 characters", statusCode: 400);

            try
            {
                var user = await auth.Register(req.Username.Trim(), req.Password, req.InviteCode);
                if (user is null)
                {
                    log.Audit("register", req.Username.Trim(), targetType: "user", data: new { success = false, error = "用户名已存在" }, ipAddress: LogService.ClientIp(ctx));
                    return Results.Problem("Username already exists", statusCode: 409);
                }

                log.Audit("register", user.Username, targetType: "user", targetId: user.Id.ToString(), data: new { success = true }, ipAddress: LogService.ClientIp(ctx), userId: user.Id);
                notify.Notify("新用户注册", $"{user.Username} 加入了系统", "/admin/users", targetRole: "staff");
                return Results.Ok(new { user.Id, user.Username, user.Role });
            }
            catch (InvalidOperationException ex)
            {
                log.Audit("register", req.Username.Trim(), targetType: "user", data: new { success = false, error = ex.Message }, ipAddress: LogService.ClientIp(ctx));
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // ── Invite Codes (admin) ──
        app.MapGet("/api/admin/invite-codes", async (AuthService auth) =>
            Results.Ok(await auth.GetInviteCodes())
        ).RequireAuthorization("AdminOnly");

        app.MapPost("/api/admin/invite-codes", async (GenerateInviteReq req, AuthService auth, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var uid = int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var code = await auth.GenerateInviteCode(uid, req.DepartmentId, req.MaxUses, req.DaysValid);
            log.Audit("invite", user.Identity?.Name ?? "unknown", targetType: "invite-code", targetId: code.Id.ToString(),
                data: new { departmentId = req.DepartmentId, maxUses = req.MaxUses, daysValid = req.DaysValid },
                ipAddress: LogService.ClientIp(ctx), userId: uid);
            return Results.Created($"/api/admin/invite-codes/{code.Id}", code);
        }).RequireAuthorization("AdminOnly");

        app.MapPost("/api/admin/invite-codes/{id:int}/revoke", async (int id, AuthService auth, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            await auth.RevokeInviteCode(id);
            log.Audit("delete", user.Identity?.Name ?? "unknown", targetType: "invite-code", targetId: id.ToString(),
                data: new { success = true }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { message = "已作废" });
        }).RequireAuthorization("AdminOnly");

        // ── CSV Import (admin) ──
        app.MapPost("/api/admin/users/import-csv", async (HttpRequest req, AuthService auth, ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var form = await req.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null) return Results.Problem("请上传CSV文件", statusCode: 400);

            using var reader = new StreamReader(file.OpenReadStream());
            var csv = await reader.ReadToEndAsync();
            var count = await auth.BulkImportUsers(csv, req.Query["password"]);
            log.Audit("import", user.Identity?.Name ?? "unknown", targetType: "user", data: new { imported = count },
                ipAddress: LogService.ClientIp(ctx));

            return Results.Ok(new { imported = count, message = $"成功导入 {count} 个用户" });
        }).RequireAuthorization("AdminOnly").DisableAntiforgery();

        app.MapPost("/api/auth/login", async (LoginRequest? req, AuthService auth, LogService log, HttpContext ctx) =>
        {
            if (req is null)
                return Results.Problem("请求体不能为空", statusCode: 400);

            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("Username and password are required", statusCode: 400);

            var token = await auth.Login(req.Username, req.Password);
            if (token is null)
            {
                log.Audit("login", req.Username, targetType: "user", data: new { success = false, error = "用户名或密码错误" },
                    ipAddress: LogService.ClientIp(ctx));
                return Results.Problem("Invalid username or password", statusCode: 401);
            }

            log.Audit("login", req.Username, targetType: "user", data: new { success = true },
                ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { token });
        }).RequireRateLimiting("login");

        app.MapGet("/api/auth/me", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
            var username = user.FindFirstValue(ClaimTypes.Name);
            var role = user.FindFirstValue(ClaimTypes.Role);

            if (idClaim is null) return Results.Problem("Not authenticated", statusCode: 401);

            var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
            var department = u?.Department?.Name;

            return Results.Ok(new { Id = int.Parse(idClaim), Username = username, Role = role, Department = department });
        }).RequireAuthorization();

        app.MapPut("/api/auth/change-password", async (ChangePasswordRequest? req, ClaimsPrincipal user, AuthService auth, NotificationService notify, LogService log, HttpContext ctx) =>
        {
            if (req is null || string.IsNullOrWhiteSpace(req.CurrentPassword) || string.IsNullOrWhiteSpace(req.NewPassword))
                return Results.Problem("当前密码和新密码不能为空", statusCode: 400);
            var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (id is null) return Results.Problem("Not authenticated", statusCode: 401);
            var success = await auth.ChangePassword(int.Parse(id), req.CurrentPassword, req.NewPassword);
            log.Audit("change-password", user.Identity?.Name ?? "unknown", targetType: "user", targetId: id,
                data: new { success }, ipAddress: LogService.ClientIp(ctx), userId: int.Parse(id));
            if (success) notify.Notify("密码已修改", "你的账号密码刚刚被修改。如非本人操作，请联系管理员。", userId: int.Parse(id));
            return success ? Results.Ok(new { success = true }) : Results.Problem("Current password is incorrect", statusCode: 400);
        }).RequireAuthorization();
    }
}

public record RegisterRequest(string Username, string Password, string? InviteCode = null);
public record GenerateInviteReq(int? DepartmentId, int MaxUses, int DaysValid);
public record LoginRequest(string Username, string Password);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
