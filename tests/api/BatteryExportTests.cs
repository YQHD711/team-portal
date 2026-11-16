using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>台账/流水 CSV 导出：列齐全、公式注入转义、借还人/归还人。</summary>
public class BatteryExportTests
{
    // 共享同一连接：内存库随连接而生，多 context 必须共用连接才看得到彼此的数据
    private readonly SqliteConnection _conn;

    public BatteryExportTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
    }

    private AppDbContext CreateContext()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        return ctx;
    }

    private static BatteryService Svc(AppDbContext db)
        => new(db, new NullLogService(new TestScopeFactory(db)), new SettingsService(new TestScopeFactory(db)));

    [Fact]
    public async Task ExportItems_HasHeaderAndRows()
    {
        var db = CreateContext();
        var svc = Svc(db);
        await svc.CreateAsync("BAT-0001", "6S", "正常", "x");
        var csv = await svc.ExportItemsCsvAsync();
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("编码,型号,状态,健康度,当前借用人,借出时间,备注", lines[0].TrimEnd('\r'));
        Assert.Contains(lines, l => l.Contains("BAT-0001") && l.Contains("6S"));
    }

    [Fact]
    public async Task ExportItems_EscapesFormulaInjection()
    {
        var db = CreateContext();
        var svc = Svc(db);
        // 备注以 = 开头（Excel 公式注入载荷）必须被引号转义
        await svc.CreateAsync("BAT-0002", null, null, "=HYPERLINK(\"http://evil\")");
        var csv = await svc.ExportItemsCsvAsync();
        Assert.Contains("'=HYPERLINK", csv);
    }

    [Fact]
    public async Task ExportLoans_ShowsBorrowerAndReturner()
    {
        var db = CreateContext();
        var svc = Svc(db);
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite().Options;
        db.Users.Add(new User { Id = 1, Username = "zhangsan", PasswordHash = "x", Role = "member" });
        db.Users.Add(new User { Id = 2, Username = "lisi", PasswordHash = "x", Role = "member" });
        await db.SaveChangesAsync();
        var item = await svc.CreateAsync("BAT-0003", null, null, null);
        // 每步用新 context：ExecuteUpdateAsync 直接改库，同 context 的 tracked 实体会陈旧
        await using (var db2 = CreateContext())
            await Svc(db2).BorrowAsync(item.Id, 1, null);
        await using (var db3 = CreateContext())
            await Svc(db3).ReturnAsync(item.Id, 2, null);

        var csv = await svc.ExportLoansCsvAsync();
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("电池编码,借用人,借出时间,归还人,归还时间,认定方式,备注", lines[0].TrimEnd('\r'));
        // 甲借乙还：借用人 zhangsan、归还人 lisi
        Assert.Contains(lines, l => l.Contains("zhangsan") && l.Contains("lisi"));
    }
}
