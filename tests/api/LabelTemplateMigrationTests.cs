using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-17 迁移：**已有库**（只会跑到上一个迁移）在升级后也必须长出 LabelTemplates 表，
/// 并且这条路是幂等的 —— 项目里新库走 <c>Migrate()</c>、历史库先 baseline 再走同一条 <c>Migrate()</c>。
/// </summary>
public class LabelTemplateMigrationTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"tp-label-mig-{Guid.NewGuid():N}.db");

    private DbContextOptions<AppDbContext> Options() =>
        new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={_dbPath}").Options;

    public void Dispose()
    {
        try { SqliteConnection.ClearAllPools(); } catch { }
        try { File.Delete(_dbPath); } catch { /* best-effort */ }
        GC.SuppressFinalize(this);
    }

    private static bool TableExists(AppDbContext db)
    {
        var conn = db.Database.GetDbConnection();
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='LabelTemplates'";
        return Convert.ToInt64(cmd.ExecuteScalar()) > 0;
    }

    [Fact]
    public async Task Upgrade_OnOldDatabase_CreatesTable_AndIsIdempotent()
    {
        // 1) 老库：只迁移到上一个版本（AddWikiDocEdit），此时还不该有 LabelTemplates
        await using (var db = new AppDbContext(Options()))
        {
            await db.GetService<IMigrator>().MigrateAsync("20261002153446_AddWikiDocEdit");
            Assert.False(TableExists(db));
        }

        // 2) 升级：老库同样走 Database.Migrate()
        await using (var db = new AppDbContext(Options()))
        {
            db.Database.Migrate();
            Assert.True(TableExists(db));
            Assert.Empty(await db.LabelTemplates.ToListAsync());   // 迁移只建表；默认模板由启动流程种

            var applied = await db.Database.GetAppliedMigrationsAsync();
            Assert.Contains(applied, m => m.EndsWith("_AddLabelTemplates", StringComparison.Ordinal));
        }

        // 3) 再跑一次不能炸（幂等）
        await using (var db = new AppDbContext(Options()))
        {
            db.Database.Migrate();
            Assert.True(await new LabelTemplateService(db).SeedDefaultIfEmptyAsync());
            var seeded = await new LabelTemplateService(db).ListAsync();
            var t = Assert.Single(seeded);
            Assert.True(t.IsDefault);
            Assert.Equal(600, t.Dpi);
            Assert.Equal(5, t.Elements.Count);
        }
    }
}
