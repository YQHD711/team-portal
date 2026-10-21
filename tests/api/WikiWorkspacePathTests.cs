using System.Text;
using TeamPortal.Services;

namespace api;

/// <summary>
/// FIX-02 回归测试（审计 I-01 / I-02 / I-04、M-11）。
///
/// 覆盖四件事：
///  1) <see cref="WorkspacePathGuard"/> 解析符号链接后再按「根 + 分隔符」断言（blob / AI 工具的公共底座）；
///  2) 克隆后整体拒绝带链接的仓库（<see cref="WikiGeneratorService.EnsureNoLinks"/>）；
///  3) read_file 的敏感扩展名黑名单；
///  4) 临时 ZIP 的保留期清理与"只删临时目录内文件"的边界。
/// 入口 400 与任务删除清理由 <c>WikiSubmitPathValidationTests</c> 走真实宿主断言。
/// </summary>
public class WikiWorkspacePathTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    private string NewDir(string label)
    {
        var path = Path.Combine(Path.GetTempPath(), $"tp-{label}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        _tempDirs.Add(path);
        return path;
    }

    /// <summary>
    /// 造目录符号链接。Windows 未开开发者模式 / 无权限时创建会抛异常。
    /// xUnit 2.x **没有**运行时跳过能力（Assert.Skip / SkipException 只在 v3 生效，
    /// 见 xunit.assert 2.9.3 文档），所以这里返回 false 时用例直接返回：
    /// CI 的 Linux 上必定真实执行断言，Windows 本地退化为不验证链接场景。
    /// </summary>
    private static bool TryCreateDirectoryLink(string linkPath, string targetPath)
    {
        try { Directory.CreateSymbolicLink(linkPath, targetPath); return true; }
        catch (Exception) { return false; }
    }

    // ── 1) 路径守卫 ─────────────────────────────────────────────────────────

    [Fact]
    public void Guard_AllowsNormalFile_AndRejectsTraversal()
    {
        var root = NewDir("ws");
        Directory.CreateDirectory(Path.Combine(root, "src"));
        File.WriteAllText(Path.Combine(root, "src", "a.cs"), "class A {}");

        Assert.NotNull(WorkspacePathGuard.TryResolveInside(root, "src/a.cs"));
        Assert.NotNull(WorkspacePathGuard.TryResolveInside(root, ""));            // 空路径 = 工作区根
        Assert.Null(WorkspacePathGuard.TryResolveInside(root, "../outside.txt"));
        Assert.Null(WorkspacePathGuard.TryResolveInside(root, "src/../../x"));
        Assert.Null(WorkspacePathGuard.TryResolveInside(root, Path.Combine(root, "src", "a.cs")));  // 绝对路径
        Assert.Null(WorkspacePathGuard.TryResolveInside(Path.Combine(root, "missing"), "a.cs"));    // 根不存在
    }

    [Fact]
    public void Guard_RejectsSymlinkEscapingRoot()
    {
        var root = NewDir("ws");
        var outside = NewDir("outside");
        File.WriteAllText(Path.Combine(outside, "secret.txt"), "top-secret");
        File.WriteAllText(Path.Combine(root, "a.cs"), "x");

        Assert.NotNull(WorkspacePathGuard.TryResolveInside(root, "a.cs"));

        if (!TryCreateDirectoryLink(Path.Combine(root, "leak"), outside)) return;

        // 这正是审计 I-01 的利用链：字符串上 leak/secret.txt 在根内，实际目标在根外。
        Assert.Null(WorkspacePathGuard.TryResolveInside(root, "leak/secret.txt"));
        Assert.Throws<InvalidOperationException>(() => WorkspacePathGuard.ResolveInside(root, "leak/secret.txt"));
    }

    [Fact]
    public void Guard_AllowsSymlinkPointingInsideRoot()
    {
        var root = NewDir("ws");
        Directory.CreateDirectory(Path.Combine(root, "src"));
        File.WriteAllText(Path.Combine(root, "src", "a.cs"), "x");
        if (!TryCreateDirectoryLink(Path.Combine(root, "link"), Path.Combine(root, "src"))) return;

        var resolved = WorkspacePathGuard.TryResolveInside(root, "link/a.cs");
        Assert.NotNull(resolved);
        Assert.EndsWith(Path.Combine("src", "a.cs"), resolved, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CloneScan_RejectsRepoContainingSymlink()
    {
        var repo = NewDir("repo");
        var outside = NewDir("outside");
        File.WriteAllText(Path.Combine(repo, "a.cs"), "x");
        WikiGeneratorService.EnsureNoLinks(repo);   // 无链接：不该抛

        if (!TryCreateDirectoryLink(Path.Combine(repo, "leak"), outside)) return;
        Assert.Throws<InvalidOperationException>(() => WikiGeneratorService.EnsureNoLinks(repo));
    }

    [Fact]
    public void NoLinkEnumeration_DoesNotFollowDirectoryLinks()
    {
        var root = NewDir("ws");
        var outside = NewDir("outside");
        File.WriteAllText(Path.Combine(outside, "secret.txt"), "top-secret");
        File.WriteAllText(Path.Combine(root, "a.cs"), "x");
        if (!TryCreateDirectoryLink(Path.Combine(root, "leak"), outside)) return;

        var files = WorkspacePathGuard.EnumerateFilesNoLinks(root).ToList();
        Assert.Contains(files, f => f.EndsWith("a.cs", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(files, f => f.EndsWith("secret.txt", StringComparison.OrdinalIgnoreCase));
    }

    // ── 2) read_file 敏感扩展名 ─────────────────────────────────────────────

    [Theory]
    [InlineData("a.cs", false)]
    [InlineData("bin/app.dll", true)]
    [InlineData("package.json", true)]
    [InlineData("data/teamportal.db", true)]
    [InlineData("x.sqlite3", true)]
    [InlineData("x.mdb", true)]
    [InlineData(".env", true)]
    [InlineData("conf/.env.local", true)]
    public void ReadFile_BlocksSensitiveExtensions(string path, bool blocked)
        => Assert.Equal(blocked, WikiGeneratorService.IsBlockedReadFile(path));

    // ── 3) 项目名 / 目标目录白名单 ───────────────────────────────────────────

    [Theory]
    [InlineData("公共", true)]
    [InlineData("proj_1-2", true)]
    [InlineData("../B", false)]
    [InlineData("..", false)]
    [InlineData(".", false)]
    [InlineData("a/b", false)]
    [InlineData("a\\b", false)]
    [InlineData("C:evil", false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("a\nb", false)]
    [InlineData("name.", false)]
    public void WikiSegment_Whitelist(string segment, bool ok)
        => Assert.Equal(ok, TeamPortal.Endpoints.WikiEndpoints.IsValidWikiSegment(segment));

    // ── 4) 临时 ZIP 保留期清理 ──────────────────────────────────────────────

    [Fact]
    public void CleanupOldArchives_RemovesOnlyExpiredZips()
    {
        var dir = NewDir("zips");
        var old = Path.Combine(dir, "old.zip");
        var fresh = Path.Combine(dir, "fresh.zip");
        var other = Path.Combine(dir, "note.txt");
        File.WriteAllText(old, "x");
        File.WriteAllText(fresh, "x");
        File.WriteAllText(other, "x");
        File.SetLastWriteTimeUtc(old, DateTime.UtcNow.AddDays(-8));

        Assert.Equal(1, SafeZipExtractor.CleanupOldArchives(TimeSpan.FromDays(7), dir));
        Assert.False(File.Exists(old));
        Assert.True(File.Exists(fresh));
        Assert.True(File.Exists(other));
    }

    [Fact]
    public void DeleteArchiveFromSource_OnlyTouchesTempArchiveDir()
    {
        Directory.CreateDirectory(SafeZipExtractor.TempZipDir);
        var zip = Path.Combine(SafeZipExtractor.TempZipDir, $"test-{Guid.NewGuid():N}.zip");
        File.WriteAllText(zip, "x");
        var source = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(zip));

        Assert.True(SafeZipExtractor.TryDeleteArchiveFromSource(source));
        Assert.False(File.Exists(zip));

        // SourceUrl 被改成任意路径时，删除接口不能变成"删服务器文件"的原语
        var victim = Path.Combine(NewDir("outside"), "victim.txt");
        File.WriteAllText(victim, "keep");
        var evil = "archive::" + Convert.ToBase64String(Encoding.UTF8.GetBytes(victim));
        Assert.False(SafeZipExtractor.TryDeleteArchiveFromSource(evil));
        Assert.True(File.Exists(victim));
    }

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, true); } catch { /* best effort */ }
        }
    }
}

/// <summary>
