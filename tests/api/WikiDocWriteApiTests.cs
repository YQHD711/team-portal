using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace api;

/// <summary>
/// PUT /api/wiki/tasks/{id}/doc：块级就地编辑的写接口。
/// 写的是 GET /tasks/{id}/doc 读的那份知识库文件；路径校验与 GET 一致（共用 DocKbPath + knowledge.CanAccess），
/// 另外只允许改本任务目录里声明过的文档（部门前缀放行 ≠ 能改同部门另一个项目）。
/// </summary>
public class WikiDocWriteApiTests : WikiDocApiTestBase
{
    public WikiDocWriteApiTests(WebApplicationFactory<Program> factory) : base(factory) { }

    [Fact]
    public async Task PutDoc_SavesContent_AndMarksEdited()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj/guide/intro.md", "# 原稿");
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask());

            var res = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc",
                new { path = "guide/intro", lang = "zh", content = "# 人工改过的正文" });

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("# 人工改过的正文", ReadDoc(kbRoot, "公共/proj/guide/intro.md"));
            var edits = await client.GetFromJsonAsync<EditsResp>("/api/wiki/tasks/t-doc/edits");
            Assert.Equal(1, edits!.Count);
            Assert.Equal(["guide/intro"], edits.Paths);
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task PutDoc_Twice_KeepsSingleMark()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj/guide/intro.md");
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask());

            await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc", new { path = "guide/intro", lang = "zh", content = "v1" });
            await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc", new { path = "guide/intro", lang = "zh", content = "v2" });

            var edits = await client.GetFromJsonAsync<EditsResp>("/api/wiki/tasks/t-doc/edits");
            Assert.Equal(1, edits!.Count);          // 同一篇文档重复写不堆标记
            Assert.Equal("v2", ReadDoc(kbRoot, "公共/proj/guide/intro.md"));
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task PutDoc_EnglishWritesSeparateFolder()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj_EN/guide/intro.md", "# EN original");
            SeedDoc(kbRoot, "公共/proj/guide/intro.md", "# ZH original");
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask());

            var res = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc",
                new { path = "guide/intro", lang = "en", content = "# English edit" });

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("# English edit", ReadDoc(kbRoot, "公共/proj_EN/guide/intro.md"));
            Assert.Equal("# ZH original", ReadDoc(kbRoot, "公共/proj/guide/intro.md")); // 中文那份不受影响
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task PutDoc_DepartmentHead_CanEditPublicProject()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj/guide/intro.md");
            var client = await LoginAsync(dbPath, kbRoot, "head1", "部长", SeedTask());

            var res = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc",
                new { path = "guide/intro", lang = "zh", content = "部长改的" });

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("部长改的", ReadDoc(kbRoot, "公共/proj/guide/intro.md"));
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task PutDoc_MemberIsForbidden_AndFileUntouched()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj/guide/intro.md", "# 原稿");
            var client = await LoginAsync(dbPath, kbRoot, "member1", "member", SeedTask());

            var res = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc",
                new { path = "guide/intro", lang = "zh", content = "# 越权改写" });

            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);   // StaffOnly 策略，绝不放宽
            Assert.Equal("# 原稿", ReadDoc(kbRoot, "公共/proj/guide/intro.md"));
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Theory]
    [InlineData("../../secret/x")]           // 穿越到任务目录之外
    [InlineData("/etc/passwd")]              // 绝对路径
    [InlineData("guide/other")]              // 在本任务目录之外（目录里没声明）
    public async Task PutDoc_RejectsPathsOutsideTheTaskCatalog(string path)
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj/guide/intro.md", "# 原稿");
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask());

            var res = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc",
                new { path, lang = "zh", content = "# 不该写进去" });

            Assert.True(res.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
                $"越界路径应被拒，实际 {(int)res.StatusCode}");
            Assert.False(File.Exists(Path.Combine(kbRoot, "secret", "x.md")));
            Assert.Equal("# 原稿", ReadDoc(kbRoot, "公共/proj/guide/intro.md"));
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task PutDoc_MissingPathOrContent_IsBadRequest()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            SeedDoc(kbRoot, "公共/proj/guide/intro.md", "# 原稿");
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask());

            var noPath = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc", new { path = "", lang = "zh", content = "x" });
            var noContent = await client.PutAsJsonAsync("/api/wiki/tasks/t-doc/doc", new { path = "guide/intro", lang = "zh", content = (string?)null });
            var task = await client.PutAsJsonAsync("/api/wiki/tasks/nope/doc", new { path = "guide/intro", content = "x" });

            Assert.Equal(HttpStatusCode.BadRequest, noPath.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, noContent.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, task.StatusCode);
            Assert.Equal("# 原稿", ReadDoc(kbRoot, "公共/proj/guide/intro.md"));
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    /// <summary>清理临时库文件与知识库目录（表数据由文件一起删掉）。</summary>
    private static void Cleanup(string dbPath, string kbRoot)
    {
        try { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); } catch { }
        try { File.Delete(dbPath); } catch { }
        try { Directory.Delete(kbRoot, true); } catch { }
    }
}
