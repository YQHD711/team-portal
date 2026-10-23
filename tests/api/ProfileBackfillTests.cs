using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 档案缺口回归：历史懒创建的 PilotProfile 会让从未打开过档案的队员
/// 不出现在 /api/admin/profiles 列表，前端 slug 映射为空 -> 档案详情链接打不开。
/// 修复：启动时幂等补建 + 用户创建路径直接建档案。
/// </summary>
public class ProfileBackfillTests
{
    private static (AppDbContext Db, SqliteConnection Conn) NewDb()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        return (db, conn);
    }

    private static ProfileService NewService(AppDbContext db)
        => new(db, new NullLogService(new TestScopeFactory(db)));

    [Fact]
    public async Task EnsureProfiles_CreatesMissing_AndIsIdempotent()
    {
        var (db, conn) = NewDb();
        await using var _ = db;
        await using var __ = conn;

        var withProfile = new User { Username = "has", PasswordHash = "x", Role = "member", Slug = "u_has" };
        var noProfile = new User { Username = "none", PasswordHash = "x", Role = "member", Slug = "u_none" };
        db.Users.AddRange(withProfile, noProfile);
        await db.SaveChangesAsync();
        db.PilotProfiles.Add(new PilotProfile { UserId = withProfile.Id, Level = "A", TotalFlightHours = 12 });
        await db.SaveChangesAsync();

        var svc = NewService(db);
        Assert.Equal(1, await svc.EnsureProfilesForAllUsersAsync());

        Assert.Equal(2, await db.PilotProfiles.CountAsync());
        var kept = await db.PilotProfiles.SingleAsync(p => p.UserId == withProfile.Id);
        Assert.Equal("A", kept.Level);
        Assert.Equal(12, kept.TotalFlightHours);
        Assert.True(await db.PilotProfiles.AnyAsync(p => p.UserId == noProfile.Id));

        Assert.Equal(0, await svc.EnsureProfilesForAllUsersAsync());
    }

    [Fact]
    public async Task ListProfiles_IncludesUnassignedMember_AfterBackfill()
    {
        var (db, conn) = NewDb();
        await using var _ = db;
        await using var __ = conn;

        var u = new User { Username = "no-dept", PasswordHash = "x", Role = "member", Slug = "u_nodept" };
        db.Users.Add(u);
        await db.SaveChangesAsync();

        var svc = NewService(db);
        Assert.Empty(await svc.ListAllProfiles());

        await svc.EnsureProfilesForAllUsersAsync();
        var all = await svc.ListAllProfiles();
        Assert.Single(all);
        var json = System.Text.Json.JsonSerializer.Serialize(all[0]);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal("u_nodept", doc.RootElement.GetProperty("Slug").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, doc.RootElement.GetProperty("Department").ValueKind);
    }
}
