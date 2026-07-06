using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private static readonly ConcurrentDictionary<string, (int attempts, DateTime lockedUntil)> _loginAttempts = new();

    public AuthService(AppDbContext db, IConfiguration config, LogService log, SettingsService settings)
    {
        _db = db; _config = config; _log = log; _settings = settings;
    }

    public async Task<User?> Register(string username, string password, string role = "member")
    {
        if (await _db.Users.AnyAsync(u => u.Username == username))
        {
            _log.Warn("auth", $"注册失败，用户名已存在: {username}", null, username);
            return null;
        }

        var minLen = await _settings.GetInt("Auth:PasswordMinLength", 6);
        if (password.Length < minLen)
            throw new InvalidOperationException($"密码长度不能少于 {minLen} 位");

        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = (role == "admin" || role == "部长") ? role : "member",
            CreatedAt = DateTime.UtcNow,
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _log.Info("auth", $"用户注册成功: {username}", $"{{\"role\":\"{user.Role}\",\"id\":{user.Id}}}", username);
        return user;
    }

    public async Task<string?> Login(string username, string password)
    {
        var maxAttempts = await _settings.GetInt("Auth:MaxLoginAttempts", 5);
        var lockoutMin = await _settings.GetInt("Auth:LockoutMinutes", 15);

        // Rate limiting
        var key = $"login:{username}";
        if (_loginAttempts.TryGetValue(key, out var entry))
        {
            if (entry.lockedUntil > DateTime.UtcNow)
            {
                var waitMin = (int)(entry.lockedUntil - DateTime.UtcNow).TotalMinutes + 1;
                _log.Warn("auth", $"Login blocked (rate limit): {username}", null, username);
                throw new InvalidOperationException($"登录尝试过于频繁，请 {waitMin} 分钟后再试");
            }
            if (entry.attempts >= maxAttempts)
            {
                _loginAttempts[key] = (entry.attempts, DateTime.UtcNow.AddMinutes(lockoutMin));
                _log.Warn("auth", $"Login locked for {lockoutMin}min: {username}", null, username);
                throw new InvalidOperationException($"登录尝试过于频繁，请 {lockoutMin} 分钟后再试");
            }
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user is null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        {
            _loginAttempts.AddOrUpdate(key,
                _ => (1, DateTime.MinValue),
                (_, e) => (e.attempts + 1, e.lockedUntil));
            _log.Warn("auth", $"Login failed: {username}", null, username);
            return null;
        }

        // Clear failed attempts on success
        _loginAttempts.TryRemove(key, out _);
        _log.Info("auth", $"User logged in: {username}", $"{{\"role\":\"{user.Role}\"}}", username);
        return await GenerateToken(user);
    }

    private async Task<string> GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
        };

        var expireDays = await _settings.GetInt("Auth:JwtExpireDays", 7);

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddDays(expireDays),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<bool> ChangePassword(int userId, string currentPassword, string newPassword)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null || !BCrypt.Net.BCrypt.Verify(currentPassword, user.PasswordHash))
            return false;

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
        await _db.SaveChangesAsync();
        _log.Info("auth", $"Password changed: {user.Username}", null, user.Username);
        return true;
    }

    public async Task SeedAdmin()
    {
        if (await _db.Users.AnyAsync(u => u.Role == "admin"))
            return;

        var username = _config["Admin:Username"];
        var password = _config["Admin:Password"];

        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            _log.Warn("auth", "Admin:Username 或 Admin:Password 未配置，跳过种子管理员创建。请在 appsettings.json 或环境变量中设置。");
            return;
        }

        var admin = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = "admin",
            CreatedAt = DateTime.UtcNow,
        };

        _db.Users.Add(admin);
        await _db.SaveChangesAsync();
        _log.Info("auth", $"种子管理员创建成功: {username}");
    }
}
