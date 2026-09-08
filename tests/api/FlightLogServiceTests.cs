using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>飞行日志服务：目录穿越防护 + 下载 + 删除。</summary>
public class FlightLogServiceTests : IDisposable
{
    private readonly string _dir;
    private readonly FlightLogService _svc;
    private readonly AppDbContext _db;

    public FlightLogServiceTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), $"tp-flightlog-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dir);
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["FlightLogs:Dir"] = _dir
            })
            .Build();
        _svc = new FlightLogService(config);

        var conn = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        _db = new AppDbContext(opts);
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { }
        _db.Dispose();
    }

    [Fact]
    public async Task GetFile_ExistingFile_ReturnsBytesAndContentType()
    {
        var path = Path.Combine(_dir, "flight.tlog");
        await File.WriteAllBytesAsync(path, new byte[] { 1, 2, 3, 4 });

        var result = _svc.GetFile("flight.tlog");
        Assert.NotNull(result);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, result!.Value.Bytes);
        Assert.Equal("application/octet-stream", result.Value.ContentType);
    }

    [Fact]
    public void GetFile_PathTraversal_ReturnsNull()
    {
        Assert.Null(_svc.GetFile("../secret.tlog"));
        Assert.Null(_svc.GetFile("..\\secret.tlog"));
        Assert.Null(_svc.GetFile("/etc/passwd"));
        Assert.Null(_svc.GetFile("a/b.tlog"));
        Assert.Null(_svc.GetFile(".hidden.tlog"));
        Assert.Null(_svc.GetFile(".."));
    }

    [Fact]
    public void GetFile_Nonexistent_ReturnsNull()
    {
        Assert.Null(_svc.GetFile("missing.tlog"));
    }

    [Fact]
    public async Task DeleteFile_Existing_ReturnsTrue_AndRemoves()
    {
        var path = Path.Combine(_dir, "delete-me.tlog");
        await File.WriteAllBytesAsync(path, new byte[] { 9 });

        Assert.True(_svc.DeleteFile("delete-me.tlog"));
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void DeleteFile_PathTraversal_ReturnsFalse()
    {
        Assert.False(_svc.DeleteFile("../../secret.tlog"));
    }

    [Fact]
    public void DeleteFile_Nonexistent_ReturnsFalse()
    {
        Assert.False(_svc.DeleteFile("nope.tlog"));
    }

    [Fact]
    public async Task ListLogs_ReturnsTlogAndBin_NewestFirst()
    {
        await File.WriteAllTextAsync(Path.Combine(_dir, "older.tlog"), "x");
        await Task.Delay(20);
        await File.WriteAllTextAsync(Path.Combine(_dir, "newer.bin"), "y");
        // 非 .tlog/.bin 应被忽略
        await File.WriteAllTextAsync(Path.Combine(_dir, "notes.txt"), "z");

        var result = await _svc.ListLogs();
        var logs = (System.Collections.IEnumerable)result!.GetType().GetProperty("logs")!.GetValue(result)!;
        var names = new List<string>();
        foreach (var l in logs)
        {
            var filename = l.GetType().GetProperty("filename")!.GetValue(l)!.ToString();
            names.Add(filename!);
        }
        Assert.Equal(new[] { "newer.bin", "older.tlog" }, names);
    }

    [Fact]
    public async Task ImportFromExcel_ReadsRowsAndWritesInventory()
    {
        // 用 MiniExcel 生成临时 xlsx
        var xlsx = Path.Combine(Path.GetTempPath(), $"inv-{Guid.NewGuid():N}.xlsx");
        try
        {
            var rows = new List<Dictionary<string, object>>
            {
                new() { ["名称"] = "螺栓", ["分类"] = "紧固件", ["数量"] = 50, ["库位"] = "A1", ["状态"] = "available" },
                new() { ["名称"] = "舵机", ["分类"] = "电子", ["数量"] = 3, ["库位"] = "B2", ["状态"] = "low" },
            };
            MiniExcelLibs.MiniExcel.SaveAs(xlsx, rows);

            var svc = new InventoryService(_db, new NullLogService(new TestScopeFactory(_db)), CreateNotification(_db));
            var count = await svc.ImportFromExcel(xlsx);

            Assert.Equal(2, count);
            var items = await _db.InventoryItems.OrderBy(i => i.Id).ToListAsync();
            Assert.Equal(2, items.Count);
            Assert.Equal("螺栓", items[0].Name);
            Assert.Equal("紧固件", items[0].Category);
            Assert.Equal(50, items[0].Quantity);
            Assert.Equal("A1", items[0].LocationCode);
            Assert.Equal("available", items[0].Status);
            Assert.Equal("C", items[0].Grade); // 无单价列 → 默认 C
            Assert.Equal("舵机", items[1].Name);
        }
        finally { try { File.Delete(xlsx); } catch { } }
    }

    private static NotificationService CreateNotification(AppDbContext db)
    {
        // 复用 NullLogService 模式：真实 NotificationService + 内存 SQLite scope
        return new NotificationService(new TestScopeFactory(db), new NullLogService(new TestScopeFactory(db)));
    }
}
