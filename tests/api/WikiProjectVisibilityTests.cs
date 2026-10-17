using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 审计 #13：知识库读接口的 **wiki 项目可见性**。
/// 路径级 ACL 只看「公共/本部门」，挡不住同部门里别人的 personal 项目；
/// 文档实际落在 `{TargetFolder}/{ProjectName}/x.md`，知道路径即可直读正文。
/// 规则收口在 <see cref="WikiProjectVisibility"/>，这里钉住判定本身。
/// </summary>
public class WikiProjectVisibilityTests
{
    private static AppDbContext NewDb()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();
        db.WikiTasks.AddRange(
            new WikiTask { Id = "1", Type = "git", ProjectName = "PublicProj", TargetFolder = "公共", Visibility = "public", UserId = 1, Status = "done" },
            new WikiTask { Id = "2", Type = "git", ProjectName = "OtherPersonal", TargetFolder = "公共", Visibility = "personal", UserId = 2, Status = "done" },
            new WikiTask { Id = "3", Type = "git", ProjectName = "OtherDept", TargetFolder = "组织部队", Visibility = "department", UserId = 2, Status = "done" });
        db.SaveChanges();
        return db;
    }

    [Fact]
    public void OtherUsersPersonalProject_IsInvisible()
    {
        using var db = NewDb();
        var invisible = WikiProjectVisibility.InvisibleProjectNames(db, "member", "技术部", userId: 1);
        Assert.True(KnowledgeAcl.IsInvisibleWikiProject("公共/OtherPersonal/doc.md", invisible));
        Assert.False(KnowledgeAcl.IsInvisibleWikiProject("公共/PublicProj/doc.md", invisible));
    }

    [Fact]
    public void OtherDepartmentsProject_IsInvisible()
    {
        using var db = NewDb();
        var invisible = WikiProjectVisibility.InvisibleProjectNames(db, "member", "技术部", userId: 1);
        Assert.True(KnowledgeAcl.IsInvisibleWikiProject("公共/OtherDept/doc.md", invisible));
    }

    [Fact]
    public void OwnPersonalProject_IsVisible()
    {
        using var db = NewDb();
        var invisible = WikiProjectVisibility.InvisibleProjectNames(db, "member", "技术部", userId: 2);
        Assert.False(KnowledgeAcl.IsInvisibleWikiProject("公共/OtherPersonal/doc.md", invisible));
    }

    [Fact]
    public void Admin_SeesEverything()
    {
        using var db = NewDb();
        var invisible = WikiProjectVisibility.InvisibleProjectNames(db, "admin", null, userId: 9);
        Assert.Empty(invisible);
        Assert.False(KnowledgeAcl.IsInvisibleWikiProject("公共/OtherPersonal/doc.md", invisible));
    }
}
