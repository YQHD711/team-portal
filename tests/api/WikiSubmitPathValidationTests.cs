using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 入口校验的集成测试：起真实宿主（真实路由 + 鉴权策略），确认非法 projectName/targetFolder 在**建任务之前**被 400 拒绝。
/// 另外验证「删除 ZIP 任务 → 源码包立刻从临时目录消失」（审计 M-11）。
/// </summary>
public class WikiSubmitPathValidationTests : WikiDocApiTestBase
{
    public WikiSubmitPathValidationTests(WebApplicationFactory<Program> factory) : base(factory) { }

    [Theory]
    [InlineData("..")]
    [InlineData("../B部门")]
    [InlineData("a/b")]
    [InlineData("a\\b")]
    [InlineData("C:x")]
    [InlineData("a\nb")]
    public async Task SubmitGit_RejectsUnsafeProjectName(string projectName)
    {
        var client = await LoginAsync(NewDbPath(), NewKbRoot(), "boss", "部长");
        var resp = await client.PostAsJsonAsync("/api/wiki/submit-git",
            new { url = "https://github.com/a/b.git", projectName });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task SubmitGit_RejectsUnsafeTargetFolder()
    {
        var client = await LoginAsync(NewDbPath(), NewKbRoot(), "boss", "部长");
        var resp = await client.PostAsJsonAsync("/api/wiki/submit-git",
            new { url = "https://github.com/a/b.git", projectName = "okproj", targetFolder = "../公共" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteZipTask_RemovesItsTempArchive()
    {
        Directory.CreateDirectory(SafeZipExtractor.TempZipDir);
        var zip = Path.Combine(SafeZipExtractor.TempZipDir, $"del-{Guid.NewGuid():N}.zip");
        File.WriteAllText(zip, "x");

        var project = $"del-{Guid.NewGuid():N}";
        var task = new WikiTask
        {
            Id = Guid.NewGuid().ToString("N"),
            Type = "zip",
            SourceUrl = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(zip)),
            ProjectName = project,
            TargetFolder = "公共",
            Status = "completed",
            Visibility = "public",
        };
        var client = await LoginAsync(NewDbPath(), NewKbRoot(), "boss", "部长", task);

        var resp = await client.DeleteAsync($"/api/wiki/tasks/{task.Id}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.False(File.Exists(zip));
    }
}