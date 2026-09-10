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

    public async Task<User?> Register(string username, string password, string? inviteCode = null)
    {
        if (await _db.Users.AnyAsync(u => u.Username == username))
        {
            _log.Warn("auth", $"注册失败，用户名已存在: {username}", null, username);
            return null;
        }

        // B-1 fix: registration requires invite code unless system explicitly allows open registration
        var openRegistrationStr = await _settings.Get("Auth:OpenRegistration", "false");
        var openRegistration = bool.TryParse(openRegistrationStr, out var open) && open;
        if (!openRegistration && string.IsNullOrEmpty(inviteCode))
            throw new InvalidOperationException("注册需要邀请码");

        // 密码长度先校验:校验失败不能消耗邀请码名额
        var minLen = await _settings.GetInt("Auth:PasswordMinLength", 6);
        if (password.Length < minLen)
            throw new InvalidOperationException($"密码长度不能少于 {minLen} 位");

        // Validate invite code if provided (or if system requires it)
        int? deptId = null;
        int? invitedById = null;
        if (!string.IsNullOrEmpty(inviteCode))
        {
            var code = await _db.InviteCodes.FirstOrDefaultAsync(c => c.Code == inviteCode && !c.IsRevoked);
            if (code is null || code.ExpiresAt < DateTime.UtcNow || code.UsedCount >= code.MaxUses)
            {
                _log.Warn("auth", $"注册失败，邀请码无效: {inviteCode}");
                throw new InvalidOperationException("邀请码无效或已过期");
            }
            deptId = code.DepartmentId;
            invitedById = code.CreatedByUserId;

            // 原子占用名额:上面的判断来自可能过期的快照,并发注册时两个请求都能通过,
            // UsedCount 会超过 MaxUses。改用条件 UPDATE,由数据库决定谁拿到最后一个名额。
            var claimed = await _db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE InviteCodes SET UsedCount = UsedCount + 1
                   WHERE Id = {code.Id} AND IsRevoked = 0 AND UsedCount < MaxUses");
            if (claimed == 0)
            {
                _log.Warn("auth", $"注册失败，邀请码名额已用尽: {inviteCode}");
                throw new InvalidOperationException("邀请码无效或已过期");
            }
            // 该实体的值已被原生 SQL 改动,脱离跟踪避免后续 SaveChanges 用陈旧值覆盖
            _db.Entry(code).State = EntityState.Detached;
        }

        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = "member",
            DepartmentId = deptId,
            InvitedByUserId = invitedById,
            CreatedAt = DateTime.UtcNow,
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _log.Info("auth", $"用户注册成功: {username}", $"{{\"role\":\"{user.Role}\",\"id\":{user.Id}}}", username);
        return user;
    }

    // ── Invite Codes ──

    /// <summary>
    /// 部长可生成邀请码,但只能指定“自己的部门”或“不限”;admin 不限。
    /// actorRole/actorDeptId 由端点从当前登录用户读取。
    /// </summary>
    public async Task<InviteCode> GenerateInviteCode(int createdByUserId, int? deptId, string? actorRole, int? actorDeptId,
        int? maxUses = null, int? daysValid = null)
    {
        if (actorRole == "部长" && deptId.HasValue && deptId != actorDeptId)
            throw new InvalidOperationException("部长仅可为本部门生成邀请码");
        var uses = maxUses ?? 1;
        var days = daysValid ?? 30;
        var code = Guid.NewGuid().ToString("N")[..8].ToUpper();
        var invite = new InviteCode
        {
            Code = code, DepartmentId = deptId, MaxUses = uses,
            CreatedByUserId = createdByUserId, ExpiresAt = DateTime.UtcNow.AddDays(days)
        };
        _db.InviteCodes.Add(invite);
        await _db.SaveChangesAsync();
        _log.Info("auth", $"Invite code generated: {code} (dept={deptId}, max={uses}, days={days})");
        return invite;
    }

    /// <summary>admin 看全部;部长仅看自己生成的邀请码(互相隔离)。</summary>
    public async Task<List<object>> GetInviteCodes(string? actorRole, int? actorId)
    {
        var q = _db.InviteCodes.Include(c => c.Department).Include(c => c.CreatedByUser).AsQueryable();
        if (actorRole == "部长") q = q.Where(c => c.CreatedByUserId == actorId);
        return await q.OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id, c.Code, c.DepartmentId,
                DepartmentName = c.Department != null ? c.Department.Name : null,
                c.MaxUses, c.UsedCount, c.IsRevoked, c.ExpiresAt, c.CreatedAt,
                CreatedBy = c.CreatedByUser != null ? c.CreatedByUser.Username : null
            }).ToListAsync<object>();
    }

    public enum InviteOp { Ok, NotFound, Forbidden }

    private async Task<InviteOp> GuardOwner(int id, string? actorRole, int? actorId)
    {
        var code = await _db.InviteCodes.FirstOrDefaultAsync(c => c.Id == id);
        if (code is null) return InviteOp.NotFound;
        if (actorRole != "admin" && code.CreatedByUserId != actorId) return InviteOp.Forbidden;
        return InviteOp.Ok;
    }

    public async Task<InviteOp> RevokeInviteCode(int id, string? actorRole, int? actorId)
    {
        var guard = await GuardOwner(id, actorRole, actorId);
        if (guard != InviteOp.Ok) return guard;
        var code = await _db.InviteCodes.FindAsync(id);
        code!.IsRevoked = true;
        await _db.SaveChangesAsync();
        return InviteOp.Ok;
    }

    public async Task<InviteOp> DeleteInviteCode(int id, string? actorRole, int? actorId)
    {
        var guard = await GuardOwner(id, actorRole, actorId);
        if (guard != InviteOp.Ok) return guard;
        var code = await _db.InviteCodes.FindAsync(id);
        _db.InviteCodes.Remove(code!);
        await _db.SaveChangesAsync();
        return InviteOp.Ok;
    }

    // ── CSV Import ──

    public async Task<int> BulkImportUsers(string csvContent, string? defaultPassword)
    {
        var lines = csvContent.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        var imported = 0;
        var pwd = defaultPassword ?? Guid.NewGuid().ToString("N")[..8];

        foreach (var line in lines.Skip(1)) // skip header
        {
            var cols = line.Split(',', StringSplitOptions.TrimEntries);
            if (cols.Length < 1 || string.IsNullOrWhiteSpace(cols[0])) continue;

            var username = cols[0].Trim();
            if (await _db.Users.AnyAsync(u => u.Username == username)) continue;

            var user = new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(pwd),
                Role = "member"
            };

            // Optional: department from column 2
            if (cols.Length >= 2 && !string.IsNullOrWhiteSpace(cols[1]))
            {
                var dept = await _db.Departments.FirstOrDefaultAsync(d => d.Name == cols[1].Trim());
                if (dept is not null) user.DepartmentId = dept.Id;
            }

            _db.Users.Add(user);
            imported++;
        }

        await _db.SaveChangesAsync();
        _log.Info("admin", $"Bulk imported {imported} users from CSV");
        return imported;
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

        var user = await _db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Username == username);
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

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
        };

        // MCP 工具(知识库/账号管理)依赖部门声明做范围校验,而 HTTP 端点是自己查库取部门的。
        // 不签发这个声明会让 MCP 侧的 dept 恒为 null(部长的本部门文档会被误判为无权)。
        if (!string.IsNullOrEmpty(user.Department?.Name))
            claims.Add(new Claim("Department", user.Department!.Name));

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
