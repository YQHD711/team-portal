using System.Security.Claims;
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

            if (req.Password.Length < 6)
                return Results.Problem("Password must be at least 6 characters", statusCode: 400);

            var user = await auth.Register(req.Username, req.Password, req.Role ?? "member");
            if (user is null)
                return Results.Problem("Username already exists", statusCode: 409);

            notify.Notify("新用户注册", $"{user.Username} 加入了系统", "/admin/users");
            return Results.Ok(new { user.Id, user.Username, user.Role });
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

        app.MapGet("/api/auth/me", (ClaimsPrincipal user) =>
        {
            var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
            var username = user.FindFirstValue(ClaimTypes.Name);
            var role = user.FindFirstValue(ClaimTypes.Role);

            if (id is null) return Results.Problem("Not authenticated", statusCode: 401);

            return Results.Ok(new { Id = int.Parse(id), Username = username, Role = role });
        }).RequireAuthorization();

        app.MapPut("/api/auth/change-password", async (ChangePasswordRequest req, ClaimsPrincipal user, AuthService auth) =>
        {
            var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (id is null) return Results.Problem("Not authenticated", statusCode: 401);
            var success = await auth.ChangePassword(int.Parse(id), req.CurrentPassword, req.NewPassword);
            return success ? Results.Ok(new { success = true }) : Results.Problem("Current password is incorrect", statusCode: 400);
        }).RequireAuthorization();
    }
}

public record RegisterRequest(string Username, string Password, string? Role);
public record LoginRequest(string Username, string Password);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
