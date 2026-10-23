using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 操作日志 CSV 必须带「真实客户端 IP」列。
/// 回归点：审计导出只有操作人和动作，没有来源 IP；HTTPS 后 X-Forwarded-For 采集到的
/// 真实来源就白采了，事后无法判断操作来自哪台设备/哪条链路。
/// </summary>
public class LogExportIpTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;

    public LogExportIpTests()
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

    private LogService CreateService()
    {
        var scopes = new TestScopeFactory(_db);
        return new LogService(scopes, NullLogger<LogService>.Instance, new SettingsService(scopes));
    }

    private void AddLog(string user, string action, string? ip)
    {
        _db.OperationLogs.Add(new OperationLog
        {
            UserName = user,
            Action = action,
            TargetType = "user",
            TargetId = "1",
            IpAddress = ip,
            CreatedAt = DateTime.UtcNow,
        });
    }

    private static string[] CsvLines(string csv)
        => csv.Split('\n')
            .Select(line => line.TrimEnd('\r'))
            .Where(line => line.Length > 0)
            .ToArray();

    [Fact]
    public async Task ExportOperationsCsv_IncludesIpAddressColumnAndValue()
    {
        AddLog("alice", "login", "203.0.113.7");
        AddLog("bob", "login", null);
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        var lines = CsvLines(await svc.ExportOperationsCsv());

        // 表头最后一列是 IP
        Assert.StartsWith("时间,操作人,操作类型,目标类型,目标,数据,IP", lines[0]);
        // 有 IP 的行落在最后一列
        Assert.Contains(lines, l => l.Contains("alice") && l.EndsWith(",203.0.113.7"));
        // 未采集到 IP 的行保留空列，不能少一个逗号导致后续列错位
        Assert.Contains(lines, l => l.Contains("bob") && l.EndsWith(","));
    }

    [Fact]
    public async Task ExportOperationsForArchive_IncludesIpAddressColumn()
    {
        AddLog("carol", "update", "198.51.100.42");
        await _db.SaveChangesAsync();

        using var svc = CreateService();
        var path = Path.Combine(Path.GetTempPath(), $"tp-opeip-{Guid.NewGuid():N}.csv");
        try
        {
            // 归档接口按 CreatedAt <= cutoff 过滤；行是刚写入的，cutoff 必须在未来
            var archive = await svc.ExportOperationsForArchive(DateTime.UtcNow.AddMinutes(5), path);
            Assert.Equal(1, archive.Count);

            var lines = CsvLines(await File.ReadAllTextAsync(path));
            Assert.StartsWith("时间,操作人,操作类型,目标类型,目标,数据,IP", lines[0]);
            Assert.Contains(lines, l => l.Contains("carol") && l.EndsWith(",198.51.100.42"));
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }
}