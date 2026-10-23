using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

public class AuthServiceTests
{
    private AppDbContext CreateContext()
    {
        // SQLite 内存库（与 MaterialServiceTests 一致；InMemory 包已从测试项目移除）
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new AppDbContext(opts);
        context.Database.EnsureCreated();
        return context;
    }

    private IConfiguration CreateConfig()
    {
        var dict = new Dictionary<string, string?>
        {
            ["Jwt:Key"] = "this-is-a-test-key-at-least-32-characters-long!!",
            ["Jwt:Issuer"] = "test",
            ["Jwt:Audience"] = "test"
        };
        return new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
    }

    private SettingsService CreateSettings(AppDbContext db)
    {
        return new SettingsService(new TestScopeFactory(db));
    }

    private static NullLogService CreateLogService(AppDbContext db)
    {
        return new NullLogService(new TestScopeFactory(db));
    }

    [Fact]
    public async Task Login_ValidCredentials_ReturnsToken()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        // Seed a user
        db.Users.Add(new User
        {
            Username = "testuser",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("password123"),
            Role = "member"
        });
        await db.SaveChangesAsync();

        var auth = new AuthService(db, config, logService, settings);
        var token = await auth.Login("testuser", "password123");

        Assert.NotNull(token);
        Assert.NotEmpty(token);
    }

    [Fact]
    public async Task Login_InvalidPassword_ReturnsNull()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        db.Users.Add(new User
        {
            Username = "testuser",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("correct"),
            Role = "member"
        });
        await db.SaveChangesAsync();

        var auth = new AuthService(db, config, logService, settings);
        var token = await auth.Login("testuser", "wrong");

        Assert.Null(token);
    }

    [Fact]
    public async Task Login_NonexistentUser_ReturnsNull()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        var auth = new AuthService(db, config, logService, settings);
        var token = await auth.Login("noone", "whatever");

        Assert.Null(token);
    }

    [Fact]
    public async Task Login_RateLimit_LocksOutAfterMaxAttempts()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        db.Users.Add(new User
        {
            Username = "target",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("real"),
            Role = "member"
        });
        await db.SaveChangesAsync();

        var auth = new AuthService(db, config, logService, settings);

        // First 5 attempts should return null (wrong password)
        for (int i = 0; i < 5; i++)
        {
            var result = await auth.Login("target", "wrong");
            Assert.Null(result);
        }

        // 6th attempt should throw due to lockout
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            auth.Login("target", "wrong"));
    }

    [Fact]
    public async Task Login_EmptyUsername_ReturnsNull()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        var auth = new AuthService(db, config, logService, settings);
        var token = await auth.Login("", "anything");

        Assert.Null(token);
    }

    [Fact]
    public async Task ChangePassword_ValidOldPwd_ReturnsTrue()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        var user = new User
        {
            Username = "pwduser",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("oldpass"),
            Role = "member"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var auth = new AuthService(db, config, logService, settings);
        var result = await auth.ChangePassword(user.Id, "oldpass", "newpass");

        Assert.True(result);

        // Verify new password works
        var token = await auth.Login("pwduser", "newpass");
        Assert.NotNull(token);
    }

    [Fact]
    public async Task ChangePassword_WrongOldPwd_ReturnsFalse()
    {
        var db = CreateContext();
        var config = CreateConfig();
        var logService = CreateLogService(db);
        var settings = CreateSettings(db);

        var user = new User
        {
            Username = "pwduser2",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("realpass"),
            Role = "member"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var auth = new AuthService(db, config, logService, settings);
        var result = await auth.ChangePassword(user.Id, "wrongpass", "newpass");

        Assert.False(result);
    }

    // ── A-01 锁定期满必须恢复（回归：旧实现到期后 attempts 仍 >= maxAttempts，会再次锁定 → 永久锁死）──

    /// <summary>
    /// 进程内失败计数表（private static）。测试用它把 lockedUntil 拨到过去，避免真等 15 分钟。
    /// 通过反射读取，仅测试使用。
    /// </summary>
    private static ConcurrentDictionary<string, (int attempts, DateTime lockedUntil)> LoginAttempts()
        => (ConcurrentDictionary<string, (int attempts, DateTime lockedUntil)>)typeof(AuthService)
            .GetField("_loginAttempts", BindingFlags.NonPublic | BindingFlags.Static)!
            .GetValue(null)!;

    private static void ExpireLockout(string username)
    {
        var key = $"login:{username}";
        var attempts = LoginAttempts();
        Assert.True(attempts.TryGetValue(key, out var entry), $"expected lockout entry for {key}");
        attempts[key] = (entry.attempts, DateTime.UtcNow.AddMinutes(-1)); // 模拟锁定期已过
    }

    private async Task<AuthService> CreateAuthWithUserAsync(AppDbContext db, string username, string password)
    {
        db.Users.Add(new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = "member"
        });
        await db.SaveChangesAsync();
        return new AuthService(db, CreateConfig(), CreateLogService(db), CreateSettings(db));
    }

    [Fact]
    public async Task Login_FiveConsecutiveFailures_EntersLockout()
    {
        const string user = "lockout-five";
        var db = CreateContext();
        var auth = await CreateAuthWithUserAsync(db, user, "rightpass123");
        try
        {
            for (var i = 0; i < 5; i++)
                Assert.Null(await auth.Login(user, "wrong"));

            // 达到上限的那一次失败就应写入锁定截止时间（而不是等下一次请求才锁）
            Assert.True(LoginAttempts().TryGetValue($"login:{user}", out var entry));
            Assert.Equal(5, entry.attempts);
            Assert.True(AuthService.IsLockoutActive(entry.lockedUntil, DateTime.UtcNow));

            // 锁定期内即使口令正确也必须被拒（锁定优先于口令校验）
            await Assert.ThrowsAsync<InvalidOperationException>(() => auth.Login(user, "rightpass123"));
        }
        finally
        {
            LoginAttempts().TryRemove($"login:{user}", out _);
        }
    }

    [Fact]
    public async Task Login_AfterLockoutExpires_WrongPassword_ReturnsNull_AndRestartsCounting()
    {
        const string user = "lockout-expire-wrong";
        var db = CreateContext();
        var auth = await CreateAuthWithUserAsync(db, user, "rightpass123");
        try
        {
            for (var i = 0; i < 5; i++)
                Assert.Null(await auth.Login(user, "wrong"));
            ExpireLockout(user);

            // 修复前这里会抛"尝试过于频繁"（到期后 attempts 仍 >= max，被再次锁定）
            var result = await auth.Login(user, "wrong");

            Assert.Null(result); // 应是一次普通失败，而不是锁定异常
            Assert.True(LoginAttempts().TryGetValue($"login:{user}", out var entry));
            Assert.Equal(1, entry.attempts); // 计数从 0 重新开始
            Assert.False(AuthService.IsLockoutActive(entry.lockedUntil, DateTime.UtcNow));
        }
        finally
        {
            LoginAttempts().TryRemove($"login:{user}", out _);
        }
    }

    [Fact]
    public async Task Login_AfterLockoutExpires_CorrectPassword_Succeeds_AndClearsEntry()
    {
        const string user = "lockout-expire-ok";
        var db = CreateContext();
        var auth = await CreateAuthWithUserAsync(db, user, "rightpass123");
        try
        {
            for (var i = 0; i < 5; i++)
                Assert.Null(await auth.Login(user, "wrong"));
            ExpireLockout(user);

            var token = await auth.Login(user, "rightpass123");

            Assert.NotNull(token);
            Assert.False(LoginAttempts().ContainsKey($"login:{user}"));
        }
        finally
        {
            LoginAttempts().TryRemove($"login:{user}", out _);
        }
    }

    [Fact]
    public async Task Login_Success_ClearsFailureCount()
    {
        const string user = "lockout-clear-on-success";
        var db = CreateContext();
        var auth = await CreateAuthWithUserAsync(db, user, "rightpass123");
        try
        {
            Assert.Null(await auth.Login(user, "wrong"));
            Assert.Null(await auth.Login(user, "wrong"));
            Assert.True(LoginAttempts().ContainsKey($"login:{user}"));

            Assert.NotNull(await auth.Login(user, "rightpass123"));

            Assert.False(LoginAttempts().ContainsKey($"login:{user}"));
        }
        finally
        {
            LoginAttempts().TryRemove($"login:{user}", out _);
        }
    }

    [Fact]
    public async Task Login_AfterExpiry_AnotherFullRoundLocksAgain()
    {
        const string user = "lockout-relock";
        var db = CreateContext();
        var auth = await CreateAuthWithUserAsync(db, user, "rightpass123");
        try
        {
            for (var i = 0; i < 5; i++)
                Assert.Null(await auth.Login(user, "wrong"));
            ExpireLockout(user);

            // 到期后重新开始计数：再满 5 次失败才应锁定
            for (var i = 0; i < 5; i++)
                Assert.Null(await auth.Login(user, "wrong"));

            Assert.True(LoginAttempts().TryGetValue($"login:{user}", out var entry));
            Assert.Equal(5, entry.attempts);
            Assert.True(AuthService.IsLockoutActive(entry.lockedUntil, DateTime.UtcNow));
            await Assert.ThrowsAsync<InvalidOperationException>(() => auth.Login(user, "wrong"));
        }
        finally
        {
            LoginAttempts().TryRemove($"login:{user}", out _);
        }
    }

    [Fact]
    public void IsLockoutActive_ComparesAgainstProvidedClock()
    {
        var now = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        Assert.False(AuthService.IsLockoutActive(now, now));                  // 恰到期 → 不再锁定
        Assert.False(AuthService.IsLockoutActive(now.AddMinutes(-1), now));   // 已过期
        Assert.True(AuthService.IsLockoutActive(now.AddSeconds(1), now));     // 仍在锁定期
    }

    [Fact]
    public async Task Register_CreatesPilotProfileImmediately()
    {
        var db = CreateContext();
        var auth = new AuthService(db, CreateConfig(), CreateLogService(db), CreateSettings(db));
        // 邀请码外键指向创建者，先种一个创建者用户
        var creator = new User { Username = "creator", PasswordHash = "x", Role = "admin", Slug = "u_creator" };
        db.Users.Add(creator);
        await db.SaveChangesAsync();
        db.InviteCodes.Add(new InviteCode
        {
            Code = "REGPROFILE", MaxUses = 1, CreatedByUserId = creator.Id,
            ExpiresAt = DateTime.UtcNow.AddDays(1),
        });
        await db.SaveChangesAsync();

        var user = await auth.Register("newbie", "password123", "REGPROFILE");

        Assert.NotNull(user);
        Assert.True(await db.PilotProfiles.AnyAsync(p => p.UserId == user!.Id));
    }
}

/// <summary>Minimal IServiceScopeFactory for SettingsService in tests.</summary>
internal class TestScopeFactory : IServiceScopeFactory
{
    private readonly AppDbContext _db;
    public TestScopeFactory(AppDbContext db) { _db = db; }
    public IServiceScope CreateScope() => new TestScope(_db);
}

internal class TestScope : IServiceScope
{
    public TestScope(AppDbContext db) { _db = db; }
    private readonly AppDbContext _db;
    private bool _disposed;
    public IServiceProvider ServiceProvider
    {
        get
        {
            var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection();
            services.AddSingleton(_db);
            return services.BuildServiceProvider();
        }
    }
    public void Dispose() { if (!_disposed) { _disposed = true; } }
}

/// <summary>
/// LogService for tests — uses a real LogService with null logger.
/// Background channel processor runs but DB writes gracefully fail (no real DB).
/// </summary>
internal class NullLogService : LogService
{
    public NullLogService(IServiceScopeFactory scopeFactory)
        : base(scopeFactory, Microsoft.Extensions.Logging.Abstractions.NullLogger<LogService>.Instance, null!)
    {
    }

}