using TeamPortal.Services;

namespace api;

/// <summary>
/// 学习库视图：结构（阶段 → 课时）与可编辑标记。
///
/// 关键约束：可见范围必须**完全继承**知识库 ACL 的结果，本类不得自行放宽。
/// 真实生效的权限是「写接口 StaffOnly + KnowledgeAcl 放行 公共/ 与 本人部门/」，
/// 因此：队员只读、部长可改公共+本部门、admin 全部、他部门一律不出现。
/// </summary>
public class StudyLibraryTests
{
    private static TreeNode FileNode(string name, string path, string ext = ".md")
        => new() { Name = name, Type = "file", Path = path, Extra = new Dictionary<string, string> { ["ext"] = ext } };

    private static TreeNode FolderNode(string name, string path, params TreeNode[] children)
        => new() { Name = name, Type = "folder", Path = path, Children = children.ToList() };

    /// <summary>构造一个作用域根节点（公共 或 &lt;部门&gt;），结构与知识库扫描结果一致。</summary>
    private static TreeNode Scope(string scope, bool withLibrary = true)
    {
        var name = scope == "公共" ? "公共知识库" : scope;
        if (!withLibrary) return FolderNode(name, scope);

        var lib = FolderNode("学习库", $"{scope}/学习库",
            FileNode("_学习路径", $"{scope}/学习库/_学习路径.md"),
            FolderNode("01-入门筑基", $"{scope}/学习库/01-入门筑基",
                FileNode("_阶段说明", $"{scope}/学习库/01-入门筑基/_阶段说明.md"),
                FileNode("01-认识航模", $"{scope}/学习库/01-入门筑基/01-认识航模.md"),
                FileNode("02_安全规范", $"{scope}/学习库/01-入门筑基/02_安全规范.md"),
                FileNode("素材清单", $"{scope}/学习库/01-入门筑基/素材清单.txt", ".txt"),
                // 阶段里的子目录不是课时，必须忽略
                FolderNode("附件", $"{scope}/学习库/01-入门筑基/附件",
                    FileNode("示意图", $"{scope}/学习库/01-入门筑基/附件/示意图.md"))),
            FolderNode("02-进阶实战", $"{scope}/学习库/02-进阶实战",
                FileNode("01-装机", $"{scope}/学习库/02-进阶实战/01-装机.md")));

        return FolderNode(name, scope, lib);
    }

    private static TreeNode[] FullTree() => [Scope("公共"), Scope("飞训部"), Scope("工程部")];

    // ── 可见范围 ──

    [Fact]
    public void Member_SeesPublicAndOwnDepartment_ReadOnly()
    {
        var scopes = StudyLibraryService.Build(FullTree(), "member", "飞训部");

        Assert.Equal(new[] { "公共", "飞训部" }, scopes.Select(s => s.Scope));
        Assert.All(scopes, s => Assert.False(s.CanEdit));
    }

    [Fact]
    public void MemberWithoutDepartment_OnlySeesPublic()
    {
        var scopes = StudyLibraryService.Build(FullTree(), "member", null);

        var only = Assert.Single(scopes);
        Assert.Equal("公共", only.Scope);
    }

    [Fact]
    public void Leader_SeesPublicAndOwnDepartment_CanEditBoth()
    {
        // 写接口是 StaffOnly，KnowledgeAcl 对 公共/ 与 本人部门/ 都放行 →
        // 部长的真实可写范围就是这两个，UI 如实反映（不制造后端不认的假限制）
        var scopes = StudyLibraryService.Build(FullTree(), "部长", "飞训部");

        Assert.Equal(new[] { "公共", "飞训部" }, scopes.Select(s => s.Scope));
        Assert.All(scopes, s => Assert.True(s.CanEdit));
    }

    [Fact]
    public void Leader_CannotSeeOrEditOtherDepartment()
    {
        var scopes = StudyLibraryService.Build(FullTree(), "部长", "飞训部");

        Assert.DoesNotContain(scopes, s => s.Scope == "工程部");
    }

    [Fact]
    public void Admin_SeesEveryScopeAndCanEditAll()
    {
        var scopes = StudyLibraryService.Build(FullTree(), "admin", null);

        Assert.Equal(new[] { "公共", "飞训部", "工程部" }, scopes.Select(s => s.Scope));
        Assert.All(scopes, s => Assert.True(s.CanEdit));
    }

    [Fact]
    public void ScopeWithoutLibraryFolder_IsSkipped()
    {
        var scopes = StudyLibraryService.Build([Scope("公共", withLibrary: false)], "admin", null);

        Assert.Empty(scopes);
    }

    [Fact]
    public void CanEditScope_MatchesEnforcedPermission()
    {
        Assert.True(StudyLibraryService.CanEditScope("公共", "admin", null));
        Assert.True(StudyLibraryService.CanEditScope("飞训部", "admin", null));
        Assert.True(StudyLibraryService.CanEditScope("公共", "部长", "飞训部"));
        Assert.True(StudyLibraryService.CanEditScope("飞训部", "部长", "飞训部"));
        Assert.False(StudyLibraryService.CanEditScope("工程部", "部长", "飞训部"));
        Assert.False(StudyLibraryService.CanEditScope("公共", "member", "飞训部"));
        Assert.False(StudyLibraryService.CanEditScope("飞训部", "member", "飞训部"));
        // 没部门的部长不该凭空拿到部门作用域
        Assert.False(StudyLibraryService.CanEditScope("飞训部", "部长", null));
    }

    // ── 结构 ──

    [Fact]
    public void Structure_StagesLessonsAndMetaFiles()
    {
        var scopes = StudyLibraryService.Build([Scope("公共")], "member", "飞训部");

        var scope = Assert.Single(scopes);
        Assert.Equal("公共学习库", scope.Label);
        Assert.Equal("公共/学习库", scope.LibraryPath);
        Assert.Equal("公共/学习库/_学习路径.md", scope.OverviewPath);

        Assert.Equal(2, scope.Stages.Count);

        var stage = scope.Stages[0];
        Assert.Equal("入门筑基", stage.Title);                                        // 数字前缀剥掉
        Assert.Equal("公共/学习库/01-入门筑基", stage.Path);
        Assert.Equal("公共/学习库/01-入门筑基/_阶段说明.md", stage.DescriptionPath);
        // 下划线说明、非 md、子目录都不当时课
        Assert.Equal(new[] { "认识航模", "安全规范" }, stage.Lessons.Select(l => l.Title));
        Assert.Equal("公共/学习库/01-入门筑基/01-认识航模.md", stage.Lessons[0].Path);
        Assert.All(stage.Lessons, l => Assert.False(l.CanEdit));

        Assert.Equal("装机", Assert.Single(scope.Stages[1].Lessons).Title);
    }

    [Fact]
    public void Structure_DepartmentScope_LabelAndEditableLessons()
    {
        var scopes = StudyLibraryService.Build([Scope("飞训部")], "部长", "飞训部");

        var scope = Assert.Single(scopes);
        Assert.Equal("飞训部学习库", scope.Label);
        Assert.True(scope.CanEdit);
        Assert.All(scope.Stages, s => Assert.True(s.CanEdit));
        Assert.All(scope.Stages.SelectMany(s => s.Lessons), l => Assert.True(l.CanEdit));
    }

    [Fact]
    public void StageWithoutLessons_StillReported()
    {
        var tree = new[]
        {
            FolderNode("公共知识库", "公共",
                FolderNode("学习库", "公共/学习库",
                    FolderNode("01-空白阶段", "公共/学习库/01-空白阶段")))
        };

        var stage = Assert.Single(Assert.Single(StudyLibraryService.Build(tree, "member", null)).Stages);

        Assert.Equal("空白阶段", stage.Title);
        Assert.Empty(stage.Lessons);
    }

    // ── 排序前缀 ──

    [Theory]
    [InlineData("01-认识航模", "认识航模")]
    [InlineData("02_安全规范", "安全规范")]
    [InlineData("10.进阶实战", "进阶实战")]
    [InlineData("03、设备清单", "设备清单")]
    [InlineData("2 概述", "概述")]
    [InlineData("认识航模", "认识航模")]
    [InlineData("01-", "01-")]                    // 只有前缀没标题：原样保留，不给空标题
    [InlineData("2026年计划", "2026年计划")]        // 数字后面没有分隔符，不算前缀
    public void StripOrderPrefix_Cases(string input, string expected)
        => Assert.Equal(expected, StudyLibraryService.StripOrderPrefix(input));
}
