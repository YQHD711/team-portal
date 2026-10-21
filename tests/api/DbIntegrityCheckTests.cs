using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// FIX-03 / 运行库完整性：维修任务每日调用的自检必须真的跑两条 PRAGMA，
/// 健康库返回 integrity_check=ok 且 0 条外键违规（只诊断，不修复）。
/// </summary>
public class DbIntegrityCheckTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public DbIntegrityCheckTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task RunAsync_HealthyDatabase_ReturnsOkAndNoForeignKeyViolations()
    {
        var (integrity, foreignKeyViolations) = await DbIntegrityCheck.RunAsync(_db);

        Assert.Equal("ok", integrity);
        Assert.Equal(0, foreignKeyViolations);
        // 连接由自检负责打开/复用，调用后仍可用
        Assert.Equal(0, await _db.Users.CountAsync());
    }
}
