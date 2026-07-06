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
                var user = await auth.Register(req.Username.Trim(), req.Password);
                if (user is null)
                    return Results.Problem("Username already exists", statusCode: 409);

                notify.Notify("新用户注册", $"{user.Username} 加入了系统", "/admin/users");
                return Results.Ok(new { user.Id, user.Username, user.Role });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Problem(ex.Message, statusCode: 400);
            }
        });

        app.MapPost("/api/auth/login", async (LoginRequest req, AuthService auth) =>
        {
            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return Results.Problem("Username and password are required", statusCode: 400);

            var token = await auth.Login(req.Username, req.Password);
            if (token is null)
                return Results.Problem("Invalid username or password", statusCode: 401);

            return Results.Ok(new { token });
        });

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

public record RegisterRequest(string Username, string Password);
public record LoginRequest(string Username, string Password);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
