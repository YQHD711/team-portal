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
