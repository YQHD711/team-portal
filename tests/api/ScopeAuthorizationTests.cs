using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 范围授权:云端文件可见范围、考核的部门范围、JWT 部门声明。
/// </summary>
public class ScopeAuthorizationTests
{
    // ── 百度网盘:非管理员不得访问 system 目录(其中含整库备份) ──

    [Theory]
    [InlineData("/apps/team-portal/system/backups/backup-1.zip", "member", false)]
    [InlineData("/apps/team-portal/system/logs/logs-1.csv", "部长", false)]
    [InlineData("/apps/team-portal/user-data/documents/a.pdf", "member", true)]
    [InlineData("/apps/team-portal/user-data/flight-logs/a.tlog", "部长", true)]
    [InlineData("/apps/team-portal/system/backups/x.zip", "admin", true)]
    [InlineData("/apps/team-portal/user-data/../../system/backups/x.zip", "member", false)]
    [InlineData(null, "member", false)]
    public void CloudPathScope(string? path, string role, bool allowed)
        => Assert.Equal(allowed, BaiduEndpoints.CanViewCloudPath(path, role));

    // ── 考核:部门范围查询 ──

    private static AppDbContext CreateDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static LogService NullLog(AppDbContext db)
        => new(new TestScopeFactory(db), Microsoft.Extensions.Logging.Abstractions.NullLogger<LogService>.Instance,
               new SettingsService(new TestScopeFactory(db)));

    [Fact]
    public async Task PassedExams_CanBeScopedToDepartment()
    {
        var db = CreateDb();
        var flight = new Department { Name = "飞训部" };
        var org = new Department { Name = "组织部" };
        db.Departments.AddRange(flight, org);
        await db.SaveChangesAsync();
        var flightUser = new User { Username = "u1", PasswordHash = "x", Role = "member", DepartmentId = flight.Id };
        var orgUser = new User { Username = "u2", PasswordHash = "x", Role = "member", DepartmentId = org.Id };
        db.Users.AddRange(flightUser, orgUser);
        await db.SaveChangesAsync();
        var examFlight = new DepartmentExam { DepartmentId = flight.Id, Title = "飞训考核", ExamType = "theory", Status = "done" };
        var examOrg = new DepartmentExam { DepartmentId = org.Id, Title = "组织考核", ExamType = "theory", Status = "done" };
        db.DepartmentExams.AddRange(examFlight, examOrg);
        await db.SaveChangesAsync();
        db.DepartmentExamResults.AddRange(
            new DepartmentExamResult { ExamId = examFlight.Id, UserId = flightUser.Id, Passed = true },
            new DepartmentExamResult { ExamId = examOrg.Id, UserId = orgUser.Id, Passed = true });
        await db.SaveChangesAsync();
        var svc = new ExamService(db, NullLog(db));

        var all = await svc.ListPassedResults();
        var scoped = await svc.ListPassedResultsForDepartment(flight.Id);

        Assert.Equal(2, all.Count);
        Assert.Single(scoped);
    }

    // ── JWT:必须带 Department 声明,否则 MCP 工具无法做部门范围校验 ──

    [Fact]
    public async Task LoginToken_ContainsDepartmentClaim()
    {
        var db = CreateDb();
        var dept = new Department { Name = "飞训部" };
        db.Departments.Add(dept);
        await db.SaveChangesAsync();
        db.Users.Add(new User
        {
            Username = "head", PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
            Role = "部长", DepartmentId = dept.Id
        });
        await db.SaveChangesAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Key"] = new string('k', 40),
            ["Jwt:Issuer"] = "TeamPortal",
            ["Jwt:Audience"] = "TeamPortal",
        }).Build();
        var auth = new AuthService(db, config, NullLog(db), new SettingsService(new TestScopeFactory(db)));

        var token = await auth.Login("head", "pw123456");

        Assert.NotNull(token);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("部长", jwt.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value);
        Assert.Equal("飞训部", jwt.Claims.FirstOrDefault(c => c.Type == "Department")?.Value);
    }
}
