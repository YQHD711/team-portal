using TeamPortal.Endpoints;

namespace api;

/// <summary>
/// 全局搜索结果的跳转目标。
///
/// 线上缺陷：知识库结果**一律**指向 <c>/admin/knowledge</c>，而 AuthGuard 会把非
/// staff 从 <c>/admin/*</c> 踢回首页 —— 队员搜到资料、点一下就被弹回首页，等于打不开。
/// 规则：学习库文档进学习库阅读页；其它文档部长/管理员进编辑器，队员进只读阅读页。
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
    [InlineData(false)]
    [InlineData(true)]
    public void StudyDoc_AlwaysGoesToTheStudyLibrary(bool staff)
    {
        var target = SearchEndpoints.KnowledgeTarget("飞训部/学习库/01-入门筑基/01-认识航模.md", staff);

        Assert.StartsWith("/study?lesson=", target);
        // 不能落到 /admin/* —— 那正是队员被踢回首页的原因
        Assert.DoesNotContain("/admin/", target);
        Assert.Equal("飞训部/学习库/01-入门筑基/01-认识航模.md",
            Uri.UnescapeDataString(target["/study?lesson=".Length..]));
    }

    [Fact]
    public void OtherDoc_MemberGetsTheReadOnlyReader()
    {
        var target = SearchEndpoints.KnowledgeTarget("公共/资料/航模入门.md", staff: false);

        Assert.StartsWith("/knowledge?path=", target);
        Assert.DoesNotContain("/admin/", target);
    }

    [Fact]
    public void OtherDoc_StaffGoesStraightToTheEditor()
    {
        var target = SearchEndpoints.KnowledgeTarget("公共/资料/航模入门.md", staff: true, keyword: "航模");

        Assert.StartsWith("/admin/knowledge?path=", target);
        Assert.Contains("q=", target);   // 保留搜索词，编辑器里继续高亮
    }

    [Fact]
    public void Targets_AreUrlEncoded()
    {
        var study = SearchEndpoints.KnowledgeTarget("公共/学习库/01 入门/认识 航模.md", staff: false);
        var read = SearchEndpoints.KnowledgeTarget("公共/资料/航模 入门.md", staff: false);

        Assert.DoesNotContain(" ", study);
        Assert.DoesNotContain(" ", read);
        Assert.Contains("%20", study);
    }
}
