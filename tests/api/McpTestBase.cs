using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// MCP 工具测试基座：文件型 SQLite + 真实 LogService（审计走后台 channel 落库）。
/// 文件型而不是内存共享连接，是为了让审计后台消费者能拿到独立 DbContext。
/// </summary>
public abstract class McpTestBase : IDisposable
{
    protected const string BusyTolerant = "Default Timeout=30;Pooling=False";

    protected readonly string Work;
    protected readonly string DbPath;
    protected readonly AppDbContext Db;
    protected readonly LogService Log;
    protected readonly IServiceScopeFactory Scopes;

    protected McpTestBase()
    {
        Work = Path.Combine(Path.GetTempPath(), $"tp-mcp-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Work);
        DbPath = Path.Combine(Work, "teamportal.db");
        Db = NewContext();
        Db.Database.EnsureCreated();

        Scopes = new FileScopeFactory(DbPath);
        Log = new LogService(Scopes, NullLogger<LogService>.Instance, new SettingsService(Scopes));

        Db.Departments.AddRange(new Department { Id = 1, Name = "飞控部" }, new Department { Id = 2, Name = "图传部" });
        Db.Users.AddRange(
            new User { Id = 1, Username = "requester", PasswordHash = "x", Role = "member", DepartmentId = 1 },
            new User { Id = 2, Username = "admin", PasswordHash = "x", Role = "admin" },
            new User { Id = 3, Username = "leader1", PasswordHash = "x", Role = "部长", DepartmentId = 1 },
            new User { Id = 4, Username = "leader2", PasswordHash = "x", Role = "部长", DepartmentId = 2 });
        Db.InventoryItems.Add(new InventoryItem { Id = 1, Name = "电机", Grade = "B", Quantity = 10, UnitPrice = 500 });
        Db.SaveChanges();
    }

    public void Dispose()
    {
        Log.Dispose();
        Db.Dispose();
        try { Directory.Delete(Work, true); } catch { /* 尽力而为 */ }
    }

    protected AppDbContext NewContext() => new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlite($"Data Source={DbPath};{BusyTolerant}").Options);

    protected static IHttpContextAccessor Accessor(string role, int userId, string name = "tester", string? department = null)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.Role, role), new(ClaimTypes.NameIdentifier, userId.ToString()), new(ClaimTypes.Name, name),
        };
        if (department is not null) claims.Add(new Claim("Department", department));
        var ctx = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
        return new HttpContextAccessor { HttpContext = ctx };
    }

    protected async Task<CheckoutRequest> CreatePendingDeptRequestAsync()
    {
        // 申请人 id1 属飞控部(有部长) → B 级申请进入 pending_dept
        var req = await new MaterialService(Db, Log).CreateCheckout(1, 1, 2, "跨部门审批测试");
        Assert.Equal("pending_dept", req.Status);
        return req;
    }

    protected async Task<OperationLog?> WaitForAuditAsync(Func<OperationLog, bool> match)
    {
        // Audit 走后台 channel(最长 3 秒一批),轮询等它落库
        for (var i = 0; i < 60; i++)
        {
            try
            {
                await using var db = NewContext();
                var hit = (await db.OperationLogs.AsNoTracking().OrderByDescending(o => o.Id).Take(20).ToListAsync())
                    .FirstOrDefault(match);
                if (hit is not null) return hit;
            }
            catch (Microsoft.Data.Sqlite.SqliteException) { /* 后台 flush 期间偶发 SQLITE_BUSY，重试 */ }
            await Task.Delay(250);
        }
        return null;
    }

    /// <summary>让 LogService 后台消费者拿到独立 DbContext，避免与测试线程共用同一个上下文。</summary>
    private sealed class FileScopeFactory : IServiceScopeFactory
    {
        private readonly string _dbPath;
        public FileScopeFactory(string dbPath) => _dbPath = dbPath;
        public IServiceScope CreateScope() => new Scope(_dbPath);

        private sealed class Scope : IServiceScope
        {
            private readonly ServiceProvider _sp;
            private readonly AppDbContext _db;
            public Scope(string dbPath)
            {
                _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
                    .UseSqlite($"Data Source={dbPath};{BusyTolerant}").Options);
                var services = new ServiceCollection();
                services.AddSingleton(_db);
                _sp = services.BuildServiceProvider();
            }
            public IServiceProvider ServiceProvider => _sp;
            public void Dispose() { _sp.Dispose(); _db.Dispose(); }
        }
    }
}
