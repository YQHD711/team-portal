using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 学习库进度：服务端持久化（不是 localStorage）、按部门统计、权限矩阵。
///
/// 关键语义：公共范围的完成率 = 全队；部门范围 = 该部门成员。
/// 勾选只影响本人（没有"帮别人标记"这种操作）。
/// </summary>
public class StudyProgressTests : IDisposable
{
    private const string L1 = "公共/学习库/01-入门/01-认识航模.md";
    private const string L2 = "公共/学习库/01-入门/02-安全规范.md";

    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly StudyProgressService _svc;

    public StudyProgressTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
        _svc = new StudyProgressService(_db);
    }

    /// <summary>飞训部 2 人(a、b) + 组织部 1 人(c)。</summary>
    private async Task<(int a, int b, int c)> SeedUsers()
    {
        var flight = new Department { Name = "飞训部" };
        var org = new Department { Name = "组织部" };
        _db.Departments.AddRange(flight, org);
        await _db.SaveChangesAsync();
        var a = new User { Username = "a", PasswordHash = "x", Role = "member", DepartmentId = flight.Id };
        var b = new User { Username = "b", PasswordHash = "x", Role = "member", DepartmentId = flight.Id };
        var c = new User { Username = "c", PasswordHash = "x", Role = "member", DepartmentId = org.Id };
        _db.Users.AddRange(a, b, c);
        await _db.SaveChangesAsync();
        return (a.Id, b.Id, c.Id);
    }

    [Fact]
    public async Task SetCompleted_IsIdempotent()
    {
        var (a, _, _) = await SeedUsers();

        await _svc.SetCompleted(a, L1, true);
        await _svc.SetCompleted(a, L1, true);   // 重复勾选不该产生第二条

        Assert.Equal(1, await _db.StudyProgresses.CountAsync());
        Assert.Contains(L1, await _svc.GetCompletedPaths(a));
    }

    [Fact]
    public async Task SetCompleted_False_Removes()
    {
        var (a, _, _) = await SeedUsers();
        await _svc.SetCompleted(a, L1, true);

        await _svc.SetCompleted(a, L1, false);

        Assert.Equal(0, await _db.StudyProgresses.CountAsync());
        Assert.Empty(await _svc.GetCompletedPaths(a));
    }

    [Fact]
    public async Task SetCompleted_UncompleteWhenAbsent_IsNoop()
    {
        var (a, _, _) = await SeedUsers();

        await _svc.SetCompleted(a, L1, false);   // 没勾过就取消：不该炸、也不该写行

        Assert.Equal(0, await _db.StudyProgresses.CountAsync());
    }

    [Fact]
    public async Task GetCompletedPaths_IsPerUser()
    {
        var (a, b, _) = await SeedUsers();
        await _svc.SetCompleted(a, L1, true);

        Assert.Contains(L1, await _svc.GetCompletedPaths(a));
        Assert.Empty(await _svc.GetCompletedPaths(b));
    }

    [Fact]
    public async Task CompletionCounts_AreScopedToDepartment()
    {
        var (a, b, c) = await SeedUsers();
        await _svc.SetCompleted(a, L1, true);
        await _svc.SetCompleted(b, L1, true);    // 飞训部两人都完成 L1
        await _svc.SetCompleted(c, L1, true);    // 组织部一人完成 L1
        await _svc.SetCompleted(a, L2, true);    // 只有 a 完成 L2

        var flight = await _svc.GetCompletionCounts("飞训部");
        var org = await _svc.GetCompletionCounts("组织部");
        var all = await _svc.GetCompletionCounts(StudyLibraryService.PublicScope);

        Assert.Equal(2, flight[L1]);
        Assert.Equal(1, flight[L2]);
        Assert.Equal(1, org[L1]);
        Assert.False(org.ContainsKey(L2));        // 该部门没人完成 → 不出现，而不是 0
        Assert.Equal(3, all[L1]);                 // 公共 = 全队
    }

    [Fact]
    public async Task CountScopeMembers_DepartmentVsTeam()
    {
        await SeedUsers();

        Assert.Equal(2, await _svc.CountScopeMembers("飞训部"));
        Assert.Equal(3, await _svc.CountScopeMembers(StudyLibraryService.PublicScope));
        Assert.Equal(0, await _svc.CountScopeMembers("不存在的部门"));
    }

    [Theory]
    [InlineData("公共", "admin", null, true)]
    [InlineData("飞训部", "admin", null, true)]
    [InlineData("公共", "部长", "飞训部", true)]
    [InlineData("飞训部", "部长", "飞训部", true)]
    [InlineData("组织部", "部长", "飞训部", false)]   // 他部门：不给看
    [InlineData("飞训部", "member", "飞训部", false)] // 队员：不给看
    [InlineData("飞训部", "部长", null, false)]       // 没部门的部长
    public void CanViewScopeStats_Matrix(string scope, string role, string? dept, bool expected)
        => Assert.Equal(expected, StudyEndpoints.CanViewScopeStats(scope, role, dept));

    [Fact]
    public void WithProgress_MapsLessonsAndCounts()
    {
        var scope = new StudyScope("公共", "公共学习库", "公共/学习库", false, null,
        [
            new StudyStage("入门", "公共/学习库/01", false, null,
                [new StudyLesson("A", L1, false), new StudyLesson("B", L2, false)]),
        ]);

        var mapped = StudyEndpoints.WithProgress(scope, new HashSet<string>(StringComparer.Ordinal) { L1 });

        Assert.Equal(2, mapped.LessonCount);
        Assert.Equal(1, mapped.CompletedCount);
        Assert.Equal(1, mapped.Stages[0].CompletedCount);
        Assert.True(mapped.Stages[0].Lessons[0].Completed);
        Assert.False(mapped.Stages[0].Lessons[1].Completed);
    }

    [Fact]
    public void WithProgress_NoProgress_AllFalse()
    {
        var scope = new StudyScope("公共", "公共学习库", "公共/学习库", false, null,
        [
            new StudyStage("入门", "公共/学习库/01", false, null, [new StudyLesson("A", L1, false)]),
        ]);

        var mapped = StudyEndpoints.WithProgress(scope, new HashSet<string>(StringComparer.Ordinal));

        Assert.Equal(0, mapped.CompletedCount);
        Assert.Equal(1, mapped.LessonCount);
        Assert.False(mapped.Stages[0].Lessons[0].Completed);
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }
}
