using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 回收站恢复：反序列化失败时**必须保留**回收站行。
/// 回归的原始缺陷：DataJson 反序列化为 null 时代码照常 Remove + SaveChanges，
/// 于是回收站行被删、数据没恢复，还返回 true（不可逆数据丢失）。
/// </summary>
public class TrashServiceRestoreTests
{
    private static (AppDbContext db, TrashService svc) Create()
    {
        var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        var log = new LogService(new TestScopeFactory(db), NullLogger<LogService>.Instance, new SettingsService(new TestScopeFactory(db)));
        // backup 只在 OriginalTable=="backup" 分支使用，本组用例不涉及
        return (db, new TrashService(db, log, null!));
    }

    private static TrashItem Row(string table, string dataJson, string title = "桨叶") => new()
    {
        OriginalTable = table, OriginalId = 7, Title = title, DataJson = dataJson,
        DeletedByUserId = 1, DeletedByName = "tester", DeletedAt = DateTime.UtcNow,
    };

    [Fact]
    public async Task Restore_NullJson_KeepsTrashRowAndReturnsFalse()
    {
        var (db, svc) = Create();
        db.TrashItems.Add(Row("InventoryItem", "null"));
        await db.SaveChangesAsync();
        var id = db.TrashItems.Single().Id;

        var ok = await svc.Restore(id);

        Assert.False(ok);
        Assert.NotNull(await db.TrashItems.FindAsync(id));   // 行必须还在，否则数据无法找回
        Assert.Equal(0, db.InventoryItems.Count());
    }

    [Theory]
    [InlineData("BatteryRecord")]
    [InlineData("IncidentRecord")]
    public async Task Restore_NullJson_OtherTables_AlsoKeepRow(string table)
    {
        var (db, svc) = Create();
        db.TrashItems.Add(Row(table, "null"));
        await db.SaveChangesAsync();
        var id = db.TrashItems.Single().Id;

        Assert.False(await svc.Restore(id));
        Assert.NotNull(await db.TrashItems.FindAsync(id));
    }

    [Fact]
    public async Task Restore_ValidJson_RecreatesItemAndRemovesTrashRow()
    {
        var (db, svc) = Create();
        var payload = new InventoryItem { Id = 7, Name = "桨叶", Category = "动力系统", Quantity = 3, Grade = "B", Status = "available", UpdatedAt = DateTime.UtcNow };
        db.TrashItems.Add(Row("InventoryItem", JsonSerializer.Serialize(payload)));
        await db.SaveChangesAsync();
        var id = db.TrashItems.Single().Id;

        Assert.True(await svc.Restore(id));
        var restored = db.InventoryItems.Single();
        Assert.Equal("桨叶", restored.Name);
        Assert.NotEqual(7, restored.Id);                     // 新主键，避免与原记录冲突
        Assert.Null(await db.TrashItems.FindAsync(id));
    }

    [Fact]
    public async Task Restore_MalformedJson_KeepsTrashRow()
    {
        var (db, svc) = Create();
        db.TrashItems.Add(Row("InventoryItem", "{ 不是合法 json"));
        await db.SaveChangesAsync();
        var id = db.TrashItems.Single().Id;

        Assert.False(await svc.Restore(id));
        Assert.NotNull(await db.TrashItems.FindAsync(id));
    }

    [Fact]
    public async Task Restore_UnknownTable_ReturnsFalseAndKeepsRow()
    {
        var (db, svc) = Create();
        db.TrashItems.Add(Row("SomethingElse", "{}"));
        await db.SaveChangesAsync();
        var id = db.TrashItems.Single().Id;

        Assert.False(await svc.Restore(id));
        Assert.NotNull(await db.TrashItems.FindAsync(id));
    }
}
