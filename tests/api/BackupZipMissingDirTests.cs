using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 「日志上传」功能删除后，系统备份不再打包 `data/flightlogs`（该目录已一并删除）。
/// 这里钉住删除后**不会引入新回归**：`AddDirectoryToZip` 对**不存在的目录**必须安全返回 0、不抛异常 ——
/// "备份服务因为一个被删掉的目录而失败"就是不可接受的回归。
/// 用反射直测这个私有助手（`BackupSystem` 需要网盘鉴权，端到端不便在单测里跑）。
/// 正向对照必须真打包成功，否则"不抛异常"可能只是方法没被真正执行到。
/// </summary>
public class BackupZipMissingDirTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public BackupZipMissingDirTests()
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
    }

    /// <summary>调用私有的 AddDirectoryToZip；该助手会写日志，所以给它一个可用的 LogService</summary>
    private int InvokeAddDirectoryToZip(ZipArchive zip, string dir)
    {
        var svc = RuntimeHelpers.GetUninitializedObject(typeof(BaiduNetdiskService));
        var logField = typeof(BaiduNetdiskService).GetField("_log", BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(logField);
        logField!.SetValue(svc, new NullLogService(new TestScopeFactory(_db)));

        var method = typeof(BaiduNetdiskService)
            .GetMethod("AddDirectoryToZip", BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);
        return (int)method!.Invoke(svc, new object[] { zip, dir, "flightlogs/" })!;
    }

    [Fact]
    public void MissingDirectory_ReturnsZeroAndDoesNotThrow()
    {
        var missing = Path.Combine(Path.GetTempPath(), $"tp-missing-{Guid.NewGuid():N}", "flightlogs");
        Assert.False(Directory.Exists(missing));

        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            Assert.Equal(0, InvokeAddDirectoryToZip(zip, missing));
        }

        // Create 模式下不能读 Entries，必须写完（dispose）后再以 Read 模式打开
        using var read = new ZipArchive(stream, ZipArchiveMode.Read);
        Assert.Empty(read.Entries);
    }

    /// <summary>正向对照：目录存在时必须真的打包（证明反射调用真的走到了打包逻辑）</summary>
    [Fact]
    public void ExistingDirectory_IsPackedRecursively()
    {
        var root = Path.Combine(Path.GetTempPath(), $"tp-present-{Guid.NewGuid():N}");
        var dir = Path.Combine(root, "flightlogs");
        Directory.CreateDirectory(Path.Combine(dir, "sub"));
        File.WriteAllText(Path.Combine(dir, "a.tlog"), "a");
        File.WriteAllText(Path.Combine(dir, "sub", "b.tlog"), "b");

        try
        {
            using var stream = new MemoryStream();
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            {
                Assert.Equal(2, InvokeAddDirectoryToZip(zip, dir));
            }

            using var read = new ZipArchive(stream, ZipArchiveMode.Read);
            Assert.Equal(2, read.Entries.Count);
            Assert.Contains(read.Entries, e => e.FullName == "flightlogs/a.tlog");
            Assert.Contains(read.Entries, e => e.FullName == "flightlogs/sub/b.tlog");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { /* 尽力而为 */ }
        }
    }
}
