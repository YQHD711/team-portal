using Microsoft.Extensions.Configuration;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 知识库访问控制:路径先归一化再判定(防 "公共/../他部门/x.md" 绕过),
/// 并禁止把知识库根目录本身当作操作目标。
/// </summary>
public class KnowledgeAccessTests : IDisposable
{
    private readonly string _kbDir;
    private readonly KnowledgeService _svc;

    public KnowledgeAccessTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-kb-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共知识库"));
        Directory.CreateDirectory(Path.Combine(_kbDir, "组织部"));
        File.WriteAllText(Path.Combine(_kbDir, "组织部", "secret.md"), "secret");
        File.WriteAllText(Path.Combine(_kbDir, "公共", "pub.md"), "public");
        File.WriteAllText(Path.Combine(_kbDir, "root.md"), "legacy root file");

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
        _svc = new KnowledgeService(config, new NullLogService(new TestScopeFactory(null!)), new TestScopeFactory(null!));
    }

    [Fact]
    public void TraversalHiddenBehindPublicPrefix_IsDenied()
    {
        // 旧实现只比较原始字符串前缀 → "公共/../组织部/secret.md" 被判为公共文件而放行,
        // 实际由 ResolvePath 解析到组织部(读/写/删/重命名共用 CanAccess)
        Assert.False(_svc.CanAccess("公共/../组织部/secret.md", "member", "飞训部"));
        Assert.False(_svc.CanAccess("公共/..\\组织部/secret.md", "member", "飞训部"));
        Assert.False(_svc.CanAccess("../../etc/passwd", "member", "飞训部"));
    }

    [Fact]
    public void LegitimatePaths_StillAllowed()
    {
        Assert.True(_svc.CanAccess("公共/pub.md", "member", "飞训部"));
        Assert.True(_svc.CanAccess("公共知识库/x.md", "member", "飞训部"));
        Assert.True(_svc.CanAccess("组织部/a.md", "member", "组织部"));
        Assert.True(_svc.CanAccess("组织部", "member", "组织部"));
        Assert.True(_svc.CanAccess("root.md", "member", null));
        Assert.True(_svc.CanAccess("组织部/a.md", "admin", null));
    }

    [Fact]
    public void OtherDepartment_IsDenied()
    {
        Assert.False(_svc.CanAccess("组织部/a.md", "member", "飞训部"));
        Assert.False(_svc.CanAccess("组织部/a.md", "部长", "飞训部"));
        // 归一化后确实落在本部门才放行:公共/../组织部/a.md → 组织部/a.md
        Assert.True(_svc.CanAccess("公共/../组织部/a.md", "部长", "组织部"));
    }

    [Fact]
    public void KnowledgeBaseRoot_IsNotAccessibleForNonAdmin()
    {
        Assert.False(_svc.CanAccess(".", "部长", "组织部"));
        Assert.False(_svc.CanAccess("", "部长", "组织部"));
        Assert.False(_svc.CanAccess("公共/..", "部长", "组织部"));
    }

    [Fact]
    public void DeleteFile_RefusesToRemoveKnowledgeBaseRoot()
    {
        Assert.Throws<InvalidOperationException>(() => _svc.DeleteFile("."));
        Assert.True(Directory.Exists(_kbDir));
        Assert.True(File.Exists(Path.Combine(_kbDir, "公共", "pub.md")));
    }

    public void Dispose()
    {
        try { Directory.Delete(_kbDir, true); } catch { /* 测试清理失败无需处理 */ }
    }
}
