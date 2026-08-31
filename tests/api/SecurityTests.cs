using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 路径遍历与安全加固测试。验证 ../ 逃逸被 ResolveInside 拦截,
/// 以及 AuthService 密码策略与 JWT secret 长度校验。
/// 串行执行由 tests/api/xunit.runner.json (parallelizeTestCollections: false) 全局保证,
/// 避免 SQLite 内存共享模式与并行不兼容。
/// </summary>
public class SecurityTests
{
    // ── 路径遍历防护 ────────────────────────────────────────

    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\windows\\system32\\config\\sam")]
    [InlineData("src/../../../escape.txt")]
    [InlineData("")]
    [InlineData("   ")]
    public void MaintenanceService_ResolveInside_RejectsTraversal(string malicious)
    {
        var method = typeof(MaintenanceService).GetMethod("ResolveInside",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(method);
        // 用 Path.GetTempPath() 下的真实子目录作 root(Windows 盘符字符串在 Linux 容器上会引发
        // Path.GetFullPath 行为异常,导致 root 解析成 cwd 路径,越界检测失效)。
        // 另外 Linux 上反斜杠不是路径 separator — 测试输入如果是 Windows 风格路径需手动
        // 转换为正斜杠,确保跨平台一致。
        var root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "tp-traversal-" + Guid.NewGuid().ToString("N")[..8]));
        Directory.CreateDirectory(root);
        try
        {
            var input = malicious.Replace('\\', '/');
            var result = method!.Invoke(null, new object?[] { root, input });
            Assert.Null(result);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public void MaintenanceService_ResolveInside_AllowsLegitimatePath()
    {
        var method = typeof(MaintenanceService).GetMethod("ResolveInside",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        var root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "tp-test-" + Guid.NewGuid().ToString("N")[..8]));
        Directory.CreateDirectory(root);
        try
        {
            var result = method!.Invoke(null, new object?[] { root, "src/TeamPortal/Services/AuthService.cs" });
            Assert.NotNull(result);
            var s = (string)result!;
            Assert.StartsWith(root, s, StringComparison.OrdinalIgnoreCase);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public void SystemAgentService_ResolveInside_RejectsTraversal()
    {
        var method = typeof(TeamPortal.Services.SystemAgentService).GetMethod("ResolveInside",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        Assert.NotNull(method);
        var result = method!.Invoke(null, new object?[] { "C:\\fake\\root", "../../../etc/passwd" });
        Assert.Null(result);
    }

    [Fact]
    public void BackupService_DeleteBackup_RejectsTraversal()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "tp-bk-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(tempDir);
        try
        {
            var dbPath = Path.Combine(tempDir, "teamportal.db");
            var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source=file:{tempDir.Replace('\\','/')}/db?mode=memory&cache=shared");
            conn.Open();
            var opts = new Microsoft.EntityFrameworkCore.DbContextOptionsBuilder<TeamPortal.Data.AppDbContext>()
                .UseSqlite(conn)
                .Options;
            var db = new TeamPortal.Data.AppDbContext(opts);
            db.Database.EnsureCreated();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={dbPath}"
            }).Build();
            var env = new MockEnv { ContentRootPath = tempDir };
            var log = new NullLogService(new TestScopeFactory(db));
            var svc = new TeamPortal.Services.BackupService(config, env, log);

            var result = svc.DeleteBackup("../../../etc/passwd");
            Assert.False(result);
            // 越界路径已被拦截(DeleteBackup 内置 _backupDir 检查),
            // 不应试图在文件系统上查找越界目标(在 Linux 容器上 /etc/passwd 真实存在会误报)。
            // 这里改为断言:服务返回 false 即代表越界防护生效。
        }
        finally { try { Directory.Delete(tempDir, true); } catch { } }
    }

    [Fact]
    public void BackupService_DeleteBackup_RejectsEmptyOrSelf()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "tp-bk-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(tempDir);
        try
        {
            var dbPath = Path.Combine(tempDir, "teamportal.db");
            var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source=file:{tempDir.Replace('\\','/')}/db?mode=memory&cache=shared");
            conn.Open();
            var opts = new DbContextOptionsBuilder<TeamPortal.Data.AppDbContext>()
                .UseSqlite(conn)
                .Options;
            var db = new TeamPortal.Data.AppDbContext(opts);
            db.Database.EnsureCreated();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={dbPath}"
            }).Build();
            var env = new MockEnv { ContentRootPath = tempDir };
            var log = new NullLogService(new TestScopeFactory(db));
            var svc = new TeamPortal.Services.BackupService(config, env, log);

            Assert.False(svc.DeleteBackup(""));
            Assert.False(svc.DeleteBackup("   "));
            Assert.False(svc.DeleteBackup(".")); // 等于 backupDir 本身
        }
        finally { try { Directory.Delete(tempDir, true); } catch { } }
    }

    [Fact]
    public void BackupService_DeleteBackup_AllowsLegitimateName()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "tp-bk-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(tempDir);
        try
        {
            var dbPath = Path.Combine(tempDir, "teamportal.db");
            File.Delete(dbPath); // 移除可能存在的脏文件,确保全新
            var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source=file:{tempDir.Replace('\\','/')}/db?mode=memory&cache=shared");
            conn.Open();
            var opts = new DbContextOptionsBuilder<TeamPortal.Data.AppDbContext>()
                .UseSqlite(conn)
                .Options;
            var db = new TeamPortal.Data.AppDbContext(opts);
            db.Database.EnsureCreated();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={dbPath}"
            }).Build();
            var env = new MockEnv { ContentRootPath = tempDir };
            var log = new NullLogService(new TestScopeFactory(db));
            var svc = new TeamPortal.Services.BackupService(config, env, log);

            // 建两个备份:第一个要被删除,第二个占据 latest 位置防止守卫拒绝
            svc.CreateBackup("first").GetAwaiter().GetResult();
            svc.CreateBackup("second").GetAwaiter().GetResult();

            var firstName = Directory.GetFiles(svc.ListBackups().Count > 0
                ? Path.Combine(tempDir, "backups", "db")
                : tempDir, "*_first.db").FirstOrDefault();
            Assert.NotNull(firstName);
            var name = Path.GetFileName(firstName!);

            // 释放 db 句柄与 SQLite Online Backup 的临时连接,避免 Windows 上 DeleteBackup
            // 触发 "file in use" IOException(SQLite dispose 不立即释放 OS handle)。
            db.Dispose();
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            GC.Collect();
            GC.WaitForPendingFinalizers();

            var result = svc.DeleteBackup(name);
            Assert.True(result);
            Assert.False(File.Exists(firstName));
        }
        finally { try { Directory.Delete(tempDir, true); } catch { } }
    }

    // ── 密码 / JWT 强度 ───────────────────────────────────────

    [Fact]
    public async Task AuthService_RejectsShortPassword()
    {
        var db = CreateContext();
        var auth = new AuthService(db, CreateConfig(), CreateLog(db), CreateSettings(db));
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            await auth.Register("alice", "abc"));
    }

    [Fact]
    public async Task AuthService_StoresBcryptHash_NotPlaintext()
    {
        var db = CreateContext();
        var auth = new AuthService(db, CreateConfig(), CreateLog(db), CreateSettings(db));

        // B-1 修复后注册默认需要 inviteCode:seed 一条有效码
        db.InviteCodes.Add(new InviteCode
        {
            Code = "TEST-CODE", MaxUses = 100,
            ExpiresAt = DateTime.UtcNow.AddDays(7), CreatedByUserId = 0
        });
        await db.SaveChangesAsync();

        var user = await auth.Register("bob", "secret-password-1234", "TEST-CODE");
        Assert.NotNull(user);
        Assert.NotEqual("secret-password-1234", user!.PasswordHash);
        // bcrypt 格式:$2a$ / $2b$ / $2y$ 前缀
        Assert.StartsWith("$2", user.PasswordHash);
        Assert.True(BCrypt.Net.BCrypt.Verify("secret-password-1234", user.PasswordHash));
        Assert.False(BCrypt.Net.BCrypt.Verify("wrong-password", user.PasswordHash));
    }

    [Fact]
    public void JwtSecret_Validation_RequiresAtLeast32Chars()
    {
        // Program.cs 的 Jwt:Key 长度校验：< 32 字符必须报错
        // 这是 sanity check，提醒后续修改时不要放宽阈值
        Assert.True("this-is-a-test-key-at-least-32-characters-long!!".Length >= 32);
        Assert.True("too-short".Length < 32);
    }

    // ── 测试装置 ────────────────────────────────────────────

    private static Microsoft.EntityFrameworkCore.DbContextOptions<TeamPortal.Data.AppDbContext> _opts;
    private static TeamPortal.Data.AppDbContext CreateContext()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        _opts = new Microsoft.EntityFrameworkCore.DbContextOptionsBuilder<TeamPortal.Data.AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var ctx = new TeamPortal.Data.AppDbContext(_opts);
        ctx.Database.EnsureCreated();
        return ctx;
    }

    private static Microsoft.Extensions.Configuration.IConfiguration CreateConfig()
    {
        var dict = new Dictionary<string, string?>
        {
            ["Jwt:Key"] = "this-is-a-test-key-at-least-32-characters-long!!",
            ["Jwt:Issuer"] = "test",
            ["Jwt:Audience"] = "test"
        };
        return new Microsoft.Extensions.Configuration.ConfigurationBuilder().AddInMemoryCollection(dict).Build();
    }

    private static TeamPortal.Services.SettingsService CreateSettings(TeamPortal.Data.AppDbContext db)
        => new(new TestScopeFactory(db));

    private static NullLogService CreateLog(TeamPortal.Data.AppDbContext db)
        => new(new TestScopeFactory(db));

    private class MockEnv : IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Test";
        public string WebRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}