using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P0 安全修复钉住：采购自批禁止、考核录入防作弊（自评/跨部门/分数）、考核删除 IDOR 归属。
/// </summary>
public class SecurityFixTests
{
    private AppDbContext CreateContext()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        var ctx = new AppDbContext(opts);
        ctx.Database.EnsureCreated();
        ctx.Departments.AddRange(new Department { Id = 1, Name = "飞训部" }, new Department { Id = 2, Name = "电训部" });
        ctx.Users.AddRange(
            new User { Id = 1, Username = "leader1", PasswordHash = "x", Role = "部长", DepartmentId = 1 },
            new User { Id = 2, Username = "leader2", PasswordHash = "x", Role = "部长", DepartmentId = 2 },
            new User { Id = 4, Username = "member1", PasswordHash = "x", Role = "member", DepartmentId = 1 },
            new User { Id = 5, Username = "member2", PasswordHash = "x", Role = "member", DepartmentId = 2 }
        );
        ctx.SaveChanges();
        return ctx;
    }

    private static FinanceService Finance(AppDbContext db) => new(db, new NullLogService(new TestScopeFactory(db)));

    private static ExamService Exam(AppDbContext db) => new(db, new NullLogService(new TestScopeFactory(db)));

    // ── 采购：自批自采禁止 ──

    [Fact]
    public async Task Finance_Approve_SelfRequest_IsRejected()
    {
        var db = CreateContext();
        var svc = Finance(db);
        var req = await svc.CreateRequest(1, "舵机", 2, 100, "测试");
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.Approve(req.Id, 1));
        Assert.Equal("pending", (await db.PurchaseRequests.FindAsync(req.Id))!.Status);
    }

    [Fact]
    public async Task Finance_Approve_ByOtherLeader_Succeeds()
    {
        var db = CreateContext();
        var svc = Finance(db);
        var req = await svc.CreateRequest(1, "舵机", 2, 100, "测试");
        Assert.True(await svc.Approve(req.Id, 2));
        Assert.Equal("approved", (await db.PurchaseRequests.FindAsync(req.Id))!.Status);
    }

    [Fact]
    public async Task Finance_CreateRequest_RejectsNonPositiveQuantity()
    {
        var db = CreateContext();
        var svc = Finance(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateRequest(1, "舵机", 0, 100, "x"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateRequest(1, "舵机", -3, 100, "x"));
    }

    [Fact]
    public async Task Finance_MarkPurchased_RejectsNegativePrice()
    {
        var db = CreateContext();
        var svc = Finance(db);
        var req = await svc.CreateRequest(1, "舵机", 2, 100, "测试");
        await svc.Approve(req.Id, 2);
        await Assert.ThrowsAsync<InvalidOperationException>(() => svc.MarkPurchased(req.Id, -50));
    }

    // ── 考核：录入防作弊 ──

    [Fact]
    public async Task Exam_AddResults_SelfEvaluation_IsRejected()
    {
        var db = CreateContext();
        var svc = Exam(db);
        var exam = new DepartmentExam { Id = 10, DepartmentId = 1, Title = "理论考", ExamType = "theory", Status = "ongoing", CreatedByUserId = 1 };
        db.DepartmentExams.Add(exam);
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.AddResults(10, 1, [new ExamResultInput(1, true, 100, null)]));
    }

    [Fact]
    public async Task Exam_AddResults_CrossDepartment_IsRejected()
    {
        var db = CreateContext();
        var svc = Exam(db);
        var exam = new DepartmentExam { Id = 11, DepartmentId = 1, Title = "理论考", ExamType = "theory", Status = "ongoing", CreatedByUserId = 1 };
        db.DepartmentExams.Add(exam);
        await db.SaveChangesAsync();

        // member2 属于电训部，不能写进飞训部的考试
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.AddResults(11, 1, [new ExamResultInput(5, true, 100, null)]));
    }

    [Fact]
    public async Task Exam_AddResults_ScoreRange_IsValidated()
    {
        var db = CreateContext();
        var svc = Exam(db);
        var exam = new DepartmentExam { Id = 12, DepartmentId = 1, Title = "理论考", ExamType = "theory", Status = "ongoing", CreatedByUserId = 1 };
        db.DepartmentExams.Add(exam);
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.AddResults(12, 1, [new ExamResultInput(4, true, -5, null)]));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.AddResults(12, 1, [new ExamResultInput(4, true, 2000, null)]));
    }

    [Fact]
    public async Task Exam_DeleteResult_RequiresMatchingExamId()
    {
        var db = CreateContext();
        var svc = Exam(db);
        var examA = new DepartmentExam { Id = 20, DepartmentId = 1, Title = "A 考", ExamType = "theory", Status = "ongoing", CreatedByUserId = 1 };
        var examB = new DepartmentExam { Id = 21, DepartmentId = 2, Title = "B 考", ExamType = "theory", Status = "ongoing", CreatedByUserId = 2 };
        db.DepartmentExams.AddRange(examA, examB);
        db.DepartmentExamResults.Add(new DepartmentExamResult { Id = 100, ExamId = 21, UserId = 5, Passed = true, Score = 90 });
        await db.SaveChangesAsync();

        // IDOR：用 examA(20) 的 id 删 examB(21) 的成绩 → 必须拒绝（找不到）
        Assert.False(await svc.DeleteResult(20, 100));
        Assert.NotNull(await db.DepartmentExamResults.FindAsync(100));

        // 正确归属可删
        Assert.True(await svc.DeleteResult(21, 100));
        Assert.Null(await db.DepartmentExamResults.FindAsync(100));
    }
}
