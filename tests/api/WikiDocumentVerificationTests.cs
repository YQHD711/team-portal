using TeamPortal.Services;

namespace api;

/// <summary>
/// 文档落盘校验。回归背景：AI 只回文本而不调用 write_doc 时不会抛异常，
/// 任务照样标记 completed —— 表现是「目录能点开、文档全 404，知识库里也没有」。
/// 现在生成后会核对文件，缺失则重试一次，仍缺失就把任务判失败/带告警。
/// </summary>
public class WikiDocumentVerificationTests
{
    private static CatalogItem Leaf(string path, string title = "标题") => new() { Path = path, Title = title };

    [Fact]
    public void FindMissingDocuments_ReturnsOnlyNotWrittenPaths()
    {
        var leaves = new[] { Leaf("a"), Leaf("b"), Leaf("c") };
        var written = new HashSet<string> { "a", "c" };

        var missing = WikiGeneratorService.FindMissingDocuments(leaves, i => written.Contains(i.Path));

        Assert.Equal(["b"], missing);
    }

    [Fact]
    public void FindMissingDocuments_AllWritten_IsEmpty()
    {
        var leaves = new[] { Leaf("getting-started/installation"), Leaf("api/reference") };

        Assert.Empty(WikiGeneratorService.FindMissingDocuments(leaves, _ => true));
    }

    [Fact]
    public void FindMissingDocuments_NoneWritten_ListsEverything()
    {
        var leaves = new[] { Leaf("a"), Leaf("b") };

        var missing = WikiGeneratorService.FindMissingDocuments(leaves, _ => false);

        Assert.Equal(["a", "b"], missing);
    }

    [Fact]
    public void FindMissingDocuments_NoLeaves_IsEmpty()
        => Assert.Empty(WikiGeneratorService.FindMissingDocuments([], _ => false));

    [Fact]
    public void MissingDocumentsSummary_TruncatesLongLists()
    {
        var many = Enumerable.Range(1, 9).Select(i => $"doc{i}").ToList();

        var summary = WikiGeneratorService.MissingDocumentsSummary(many);

        // 只列前 5 个 + "等"，否则错误信息会长到看不清
        Assert.Equal("doc1、doc2、doc3、doc4、doc5 等", summary);
    }

    [Fact]
    public void MissingDocumentsSummary_ShortList_HasNoEllipsis()
        => Assert.Equal("a、b", WikiGeneratorService.MissingDocumentsSummary(["a", "b"]));

    [Theory]
    [InlineData("getting-started/installation", true)]
    [InlineData("../secret", false)]
    [InlineData("/etc/passwd", false)]
    [InlineData("a/../b", false)]
    [InlineData("", false)]
    public void IsSafeCatalogPath_MatchesVerificationFilter(string path, bool safe)
        => Assert.Equal(safe, WikiGeneratorService.IsSafeCatalogPath(path));
}
