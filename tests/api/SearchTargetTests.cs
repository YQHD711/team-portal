using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 全局搜索里知识库结果的「给谁看 / 点去哪」。
///
/// 线上缺陷：知识库结果**一律**指向 <c>/admin/knowledge</c>，而 AuthGuard 会把非 staff
/// 从 <c>/admin/*</c> 踢回首页 —— 队员搜到资料、点一下就被弹回首页。
/// 规则（本次与用户确认）：知识库本体是管理端内容，**队员的搜索结果里不出现知识库文档**，
/// 只保留学习库（公共 + 本部门，ACL 已在 KnowledgeSearchService 过滤）；学习库课时进
/// 学习库阅读页，说明类文档进学习库总览页，其余（只可能是 staff 看到的）进管理端编辑器。
/// </summary>
public class SearchTargetTests
{
    [Theory]
    [InlineData("公共/学习库/01-入门筑基/01-认识航模.md", true)]
    [InlineData("飞训部/学习库/_飞训路径.md", true)]
    [InlineData("电子部/学习库/07-ROS2教程/03-工作空间与colcon构建.md", true)]
    [InlineData("公共/资料/航模入门.md", false)]
    [InlineData("学习库.md", false)]                    // 只是文件名带这三个字，不是目录
    [InlineData("飞训部/学习库档案/笔记.md", false)]
    public void IsStudyDoc_OnlyMatchesTheLibraryFolder(string path, bool expected)
    {
        Assert.Equal(expected, SearchEndpoints.IsStudyDoc(path));
    }

    [Fact]
    public void IsStudyDoc_HandlesWindowsSeparators()
    {
        Assert.True(SearchEndpoints.IsStudyDoc(@"飞训部\学习库\01-入门筑基\01-认识航模.md"));
    }

    [Theory]
    [InlineData("公共/学习库/_学习路径.md", true)]
    [InlineData("飞训部/学习库/01-入门筑基/_阶段说明.md", true)]
    [InlineData("公共/学习库/01-入门筑基/01-认识航模.md", false)]
    public void IsStudyOverviewDoc_RecognizesUnderscoreDocs(string path, bool expected)
    {
        Assert.Equal(expected, SearchEndpoints.IsStudyOverviewDoc(path));
    }

    // ── 队员能看到什么 ──────────────────────────────────────

    [Fact]
    public void Member_SeesOnlyStudyLibraryDocs()
    {
        Assert.True(SearchEndpoints.ShouldIncludeKnowledgeResult("飞训部/学习库/01-入门筑基/01-认识航模.md", staff: false));
        Assert.False(SearchEndpoints.ShouldIncludeKnowledgeResult("公共/资料/航模入门.md", staff: false));
        Assert.False(SearchEndpoints.ShouldIncludeKnowledgeResult("飞训部/会议记录/2026-09.md", staff: false));
    }

    [Fact]
    public void Staff_SeesTheWholeKnowledgeBase()
    {
        Assert.True(SearchEndpoints.ShouldIncludeKnowledgeResult("公共/资料/航模入门.md", staff: true));
        Assert.True(SearchEndpoints.ShouldIncludeKnowledgeResult("飞训部/学习库/01-入门筑基/01-认识航模.md", staff: true));
    }

    // ── 点去哪 ──────────────────────────────────────────────

    [Fact]
    public void StudyLesson_GoesToTheStudyLibraryLesson()
    {
        var target = SearchEndpoints.KnowledgeTarget("飞训部/学习库/01-入门筑基/01-认识航模.md");

        Assert.StartsWith("/study?lesson=", target);
        // 绝不能落到 /admin/* —— 那正是队员被踢回首页的原因
        Assert.DoesNotContain("/admin/", target);
        Assert.Equal("飞训部/学习库/01-入门筑基/01-认识航模.md",
            Uri.UnescapeDataString(target["/study?lesson=".Length..]));
    }

    [Theory]
    [InlineData("公共/学习库/_学习路径.md")]
    [InlineData("飞训部/学习库/01-入门筑基/_阶段说明.md")]
    public void StudyOverview_GoesToTheLibraryOverview(string path)
    {
        // 说明类文档不是课时，正文在学习库总览页直接展示
        Assert.Equal("/study", SearchEndpoints.KnowledgeTarget(path));
    }

    [Fact]
    public void OtherDoc_GoesToTheEditorAndKeepsTheKeyword()
    {
        var target = SearchEndpoints.KnowledgeTarget("公共/资料/航模入门.md", keyword: "航模");

        Assert.StartsWith("/admin/knowledge?path=", target);
        Assert.Contains("q=", target);
    }

    [Fact]
    public void Targets_AreUrlEncoded()
    {
        var study = SearchEndpoints.KnowledgeTarget("公共/学习库/01 入门/认识 航模.md");
        var other = SearchEndpoints.KnowledgeTarget("公共/资料/航模 入门.md");

        Assert.DoesNotContain(" ", study);
        Assert.DoesNotContain(" ", other);
        Assert.Contains("%20", study);
    }

    // ── wiki 正文 ───────────────────────────────────────────

    [Fact]
    public void VisibleWikiDoc_IsIncludedForMembersToo()
    {
        // wiki 文档存在知识库目录里，但有独立的 Visibility 规则、也能在 /wiki 页读，
        // 所以对队员可见的 wiki 正文要出现在搜索结果里（否则"可见的 wiki 内容搜不到"）
        Assert.True(SearchEndpoints.ShouldIncludeKnowledgeResult("公共/某项目/01-概览.md", staff: false, visibleWikiDoc: true));
        // 不可见的 wiki 文档与普通知识库文档一样，对队员不返回
        Assert.False(SearchEndpoints.ShouldIncludeKnowledgeResult("飞训部/他部门项目/01-概览.md", staff: false, visibleWikiDoc: false));
    }

    [Fact]
    public void WikiDocPath_StripsProjectPrefixAndExtension()
    {
        Assert.Equal("getting-started/intro",
            SearchEndpoints.WikiDocPath("公共/某项目/getting-started/intro.md", "公共/某项目/"));
        // 前缀对不上（不该发生）时退化为原路径去掉 .md，至少不会拼出越界路径
        Assert.Equal("公共/别的/x", SearchEndpoints.WikiDocPath("公共/别的/x.md", "公共/某项目/"));
    }

    [Fact]
    public void WikiDocPath_KeepsNestedFolders()
    {
        Assert.Equal("a/b/c", SearchEndpoints.WikiDocPath(@"公共\项目\a\b\c.md", "公共/项目/"));
    }

    [Fact]
    public void WikiDocTarget_PointsAtTheWikiViewerWithDocParam()
    {
        var target = SearchEndpoints.WikiDocTarget("task-1", "getting-started/intro");

        Assert.Equal("/wiki/task-1?doc=getting-started%2Fintro", target);
        Assert.DoesNotContain("/admin/", target);
    }
}
