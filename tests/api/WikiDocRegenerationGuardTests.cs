using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 防「重新生成覆盖人工修改」（方案 c）：POST /tasks/{id}/update
///   - 无标记 → 行为与改动前完全一致（照旧重新生成）
///   - 有标记且未确认 → 409 + needConfirm/modifiedCount/paths，**不调用 AI、不覆盖**
///   - force=true → 覆盖并清除该任务的全部标记
/// 用例用空目录任务，避开真实 AI 调用（快且不依赖网络）。
/// </summary>
public class WikiDocRegenerationGuardTests : WikiDocApiTestBase
{
    private sealed record UpdateResp(bool Success, string? Message, int ClearedEdits);

    public WikiDocRegenerationGuardTests(WebApplicationFactory<Program> factory) : base(factory) { }

    private static async Task SeedMarkAsync(string dbPath, string taskId, string path, string lang = "zh")
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        db.WikiDocEdits.Add(new WikiDocEdit { TaskId = taskId, Path = path, Lang = lang, Editor = "admin1" });
        await db.SaveChangesAsync();
    }

    private static async Task<int> CountMarksAsync(string dbPath, string taskId)
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        await using var db = new AppDbContext(opts);
        return await db.WikiDocEdits.CountAsync(m => m.TaskId == taskId);
    }

    [Fact]
    public async Task Update_WithoutMarks_BehavesExactlyAsBefore()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask("t-plain", "[]"));

            var res = await client.PostAsync("/api/wiki/tasks/t-plain/update", null);

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var body = await res.Content.ReadFromJsonAsync<UpdateResp>();
            Assert.True(body!.Success);
            Assert.Equal(0, body.ClearedEdits);   // 没有标记，一切照旧
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task Update_WhenMarked_WithoutForce_Returns409AndKeepsEverything()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask("t-marked", "[]"));
            await SeedMarkAsync(dbPath, "t-marked", "guide/intro");

            var res = await client.PostAsync("/api/wiki/tasks/t-marked/update", null);

            Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
            var body = await res.Content.ReadFromJsonAsync<NeedConfirmResp>();
            Assert.True(body!.NeedConfirm);
            Assert.Equal(1, body.ModifiedCount);
            Assert.Equal(["guide/intro"], body.Paths);
            Assert.Contains("人工修改", body.Detail);
            Assert.Equal(1, await CountMarksAsync(dbPath, "t-marked"));   // 标记没被清
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task Update_WithForce_RegeneratesAndClearsMarks()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            var client = await LoginAsync(dbPath, kbRoot, "admin1", "admin", SeedTask("t-forced", "[]"));
            await SeedMarkAsync(dbPath, "t-forced", "guide/intro");
            await SeedMarkAsync(dbPath, "t-forced", "guide/usage", "en");

            var res = await client.PostAsync("/api/wiki/tasks/t-forced/update?force=true", null);

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var body = await res.Content.ReadFromJsonAsync<UpdateResp>();
            Assert.True(body!.Success);
            Assert.Equal(2, body.ClearedEdits);            // 确认后清标记
            Assert.Equal(0, await CountMarksAsync(dbPath, "t-forced"));
            var edits = await client.GetFromJsonAsync<EditsResp>("/api/wiki/tasks/t-forced/edits");
            Assert.Equal(0, edits!.Count);
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    [Fact]
    public async Task Update_MemberIsForbidden_EvenWithForce()
    {
        var dbPath = NewDbPath();
        var kbRoot = NewKbRoot();
        try
        {
            var client = await LoginAsync(dbPath, kbRoot, "member1", "member", SeedTask("t-member", "[]"));
            await SeedMarkAsync(dbPath, "t-member", "guide/intro");

            var res = await client.PostAsync("/api/wiki/tasks/t-member/update?force=true", null);

            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
            Assert.Equal(1, await CountMarksAsync(dbPath, "t-member"));
        }
        finally { Cleanup(dbPath, kbRoot); }
    }

    private static void Cleanup(string dbPath, string kbRoot)
    {
        try { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); } catch { }
        try { File.Delete(dbPath); } catch { }
        try { Directory.Delete(kbRoot, true); } catch { }
    }
}
