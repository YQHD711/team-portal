using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 库存 Excel 导入的文件路径白名单。
/// POST /api/inventory/import 的 FilePath 客户端可控且会被直接 File.OpenRead,
/// 不限制目录就等于任意本地文件读取/探测原语。
/// </summary>
public class InventoryImportPathTests
{
    private static AppDbContext CreateDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        return db;
    }

    [Fact]
    public void TempDirectoryFile_IsAllowed()
    {
        var db = CreateDb();
        var path = Path.Combine(Path.GetTempPath(), $"parts-{Guid.NewGuid():N}.xlsx");

        Assert.True(InventoryEndpoints.IsImportPathAllowed(path, db));
    }

    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("/etc/passwd")]
    [InlineData("/root/.env")]
    public void AbsoluteOrEscapingPaths_AreDenied(string path)
    {
        var db = CreateDb();

        Assert.False(InventoryEndpoints.IsImportPathAllowed(path, db));
    }

    [Fact]
    public void SiblingDirectoryWithSamePrefix_IsDenied()
    {
        // 前缀比较必须带分隔符:否则 <temp>/x 会匹配到 <temp>x 这类同前缀兄弟目录
        var db = CreateDb();
        var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        var sibling = temp + "x" + Path.DirectorySeparatorChar + "evil.xlsx";

        Assert.False(InventoryEndpoints.IsImportPathAllowed(sibling, db));
    }

    [Fact]
    public void EmptyPath_IsDenied()
    {
        var db = CreateDb();

        Assert.False(InventoryEndpoints.IsImportPathAllowed("", db));
        Assert.False(InventoryEndpoints.IsImportPathAllowed("   ", db));
    }
}
