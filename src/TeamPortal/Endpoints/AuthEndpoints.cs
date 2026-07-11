using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/register", async (RegisterRequest req, AuthService auth, NotificationService notify) =>
        {
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
                    return Results.Problem("Username already exists", statusCode: 409);

                notify.Notify("新用户注册", $"{user.Username} 加入了系统", "/admin/users", targetRole: "staff");
                return Results.Ok(new { user.Id, user.Username, user.Role });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        // ── Invite Codes (admin) ──
        app.MapGet("/api/admin/invite-codes", async (AuthService auth, ClaimsPrincipal user, AppDbContext db) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            if (role != "admin") return Results.Problem("仅管理员可管理邀请码", statusCode: 403);
            return Results.Ok(await auth.GetInviteCodes());
        }).RequireAuthorization();

        app.MapPost("/api/admin/invite-codes", async (GenerateInviteReq req, AuthService auth, ClaimsPrincipal user, AppDbContext db) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            if (role != "admin") return Results.Problem("仅管理员可生成邀请码", statusCode: 403);
            var uid = int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var code = await auth.GenerateInviteCode(uid, req.DepartmentId, req.MaxUses, req.DaysValid);
            return Results.Created($"/api/admin/invite-codes/{code.Id}", code);
        }).RequireAuthorization();

        app.MapPost("/api/admin/invite-codes/{id:int}/revoke", async (int id, AuthService auth, ClaimsPrincipal user, AppDbContext db) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            if (role != "admin") return Results.Problem("仅管理员可操作", statusCode: 403);
            await auth.RevokeInviteCode(id);
            return Results.Ok(new { message = "已作废" });
        }).RequireAuthorization();

        // ── CSV Import (admin) ──
        app.MapPost("/api/admin/users/import-csv", async (HttpRequest req, AuthService auth, ClaimsPrincipal user) =>
        {
            var role = user.FindFirstValue(ClaimTypes.Role);
            if (role != "admin") return Results.Problem("仅管理员可导入", statusCode: 403);

            var form = await req.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null) return Results.Problem("请上传CSV文件", statusCode: 400);

            using var reader = new StreamReader(file.OpenReadStream());
            var csv = await reader.ReadToEndAsync();
            var count = await auth.BulkImportUsers(csv, req.Query["password"]);

            return Results.Ok(new { imported = count, message = $"成功导入 {count} 个用户" });
        }).RequireAuthorization().DisableAntiforgery();

        app.MapPost("/api/auth/login", async (LoginRequest req, AuthService auth) =>
        {
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("Username and password are required", statusCode: 400);

            var token = await auth.Login(req.Username, req.Password);
            if (token is null)
                return Results.Problem("Invalid username or password", statusCode: 401);

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

        app.MapPut("/api/auth/change-password", async (ChangePasswordRequest req, ClaimsPrincipal user, AuthService auth, NotificationService notify) =>
        {
            var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (id is null) return Results.Problem("Not authenticated", statusCode: 401);
            var success = await auth.ChangePassword(int.Parse(id), req.CurrentPassword, req.NewPassword);
            if (success) notify.Notify("密码已修改", "你的账号密码刚刚被修改。如非本人操作，请联系管理员。", userId: int.Parse(id));
            return success ? Results.Ok(new { success = true }) : Results.Problem("Current password is incorrect", statusCode: 400);
        }).RequireAuthorization();
    }
}

public record RegisterRequest(string Username, string Password, string? InviteCode = null);
public record GenerateInviteReq(int? DepartmentId, int MaxUses, int DaysValid);
public record LoginRequest(string Username, string Password);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
