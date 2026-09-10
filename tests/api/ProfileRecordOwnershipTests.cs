using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 档案记录归属校验:端点只校验了"路由上的 userId 可管理",
/// 记录必须同时属于该 userId,否则部长可用本部门成员 userId 改删他人记录(IDOR)。
/// </summary>
public class ProfileRecordOwnershipTests
{
    private static AppDbContext CreateDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static async Task<(AppDbContext Db, ProfileService Svc, int OwnerId, int OtherId)> SeedAsync()
    {
        var db = CreateDb();
        var owner = new User { Username = "owner", PasswordHash = "x", Role = "member" };
        var other = new User { Username = "other", PasswordHash = "x", Role = "member" };
        db.Users.AddRange(owner, other);
        await db.SaveChangesAsync();
        return (db, new ProfileService(db, new NullLogService(new TestScopeFactory(db))), owner.Id, other.Id);
    }

    [Fact]
    public async Task TrainingRecord_CannotBeTouchedByAnotherUser()
    {
        var (db, svc, ownerId, otherId) = await SeedAsync();
        var record = new TrainingRecord { UserId = ownerId, CourseName = "原课程", ExamDate = DateTime.UtcNow };
        db.TrainingRecords.Add(record);
        await db.SaveChangesAsync();

        Assert.False(await svc.UpdateTrainingRecord(record.Id, otherId, "篡改", null, null, null, null));
        Assert.False(await svc.DeleteTrainingRecord(record.Id, otherId));
        Assert.Equal("原课程", (await db.TrainingRecords.FindAsync(record.Id))!.CourseName);

        // 归属人自己仍可正常改
        Assert.True(await svc.UpdateTrainingRecord(record.Id, ownerId, "新课程", null, null, null, null));
        Assert.Equal("新课程", (await db.TrainingRecords.FindAsync(record.Id))!.CourseName);
    }

    [Fact]
    public async Task CompetitionRecord_CannotBeTouchedByAnotherUser()
    {
        var (db, svc, ownerId, otherId) = await SeedAsync();
        var record = new CompetitionRecord { UserId = ownerId, CompetitionName = "原比赛", Date = DateTime.UtcNow };
        db.CompetitionRecords.Add(record);
        await db.SaveChangesAsync();

        Assert.False(await svc.UpdateCompetitionRecord(record.Id, otherId, "篡改", null, null, null, null, null));
        Assert.False(await svc.DeleteCompetitionRecord(record.Id, otherId));
        Assert.Equal("原比赛", (await db.CompetitionRecords.FindAsync(record.Id))!.CompetitionName);

        Assert.True(await svc.DeleteCompetitionRecord(record.Id, ownerId));
        Assert.Empty(db.CompetitionRecords);
    }
}
