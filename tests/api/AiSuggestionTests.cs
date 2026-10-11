using System.Text.RegularExpressions;

namespace api;

/// <summary>
/// task-14 A：出题内容必须**真实**（文档名/小节名都来自知识库）且**守 ACL**（不给无权文档出题）。
/// </summary>
public class AiSuggestionTests : AiSuggestionTestBase
{
    [Fact]
    public async Task Build_ReturnsUpToFour_ValidKinds_AndStudyQuestionForOwnDepartment()
    {
        var items = await Create().BuildAsync("member", "工程部", 7);

        Assert.Equal(4, items.Count);
        Assert.All(items, s => Assert.Contains(s.Kind, new[] { "doc", "study", "inventory" }));
        Assert.Contains(items, s => s.Kind == "study" && s.Text == "工程部怎么学？");
        Assert.Contains(items, s => s.Kind == "inventory" && s.Text == "「1030 库房」的货架分布？");
        Assert.Contains(items, s => s.Kind == "inventory" && s.Text == "「碳纤维管」还剩多少？");
        Assert.Contains(items, s => s.Kind == "doc");
    }

    [Fact]
    public async Task DocQuestions_OnlyReferenceRealTitlesAndHeadings()
    {
        var items = await Create().BuildAsync("member", "工程部", 7);
        var real = RealDocFiles();
        var docs = items.Where(s => s.Kind == "doc").ToList();
        Assert.NotEmpty(docs);

        foreach (var suggestion in docs)
        {
            var title = Regex.Match(suggestion.Text, "《(.+?)》").Groups[1].Value;
            Assert.True(real.ContainsKey(title), $"文档名不在知识库里（编造？）：{title}");

            var heading = Regex.Match(suggestion.Text, "「(.+?)」").Groups[1].Value;
            if (heading.Length == 0) continue;
            Assert.True(real[title].Any(f =>
                    Regex.IsMatch(File.ReadAllText(f), $@"^#{{2,3}}\s+{Regex.Escape(heading)}\s*$", RegexOptions.Multiline)),
                $"小节名不是该文档里真实存在的标题：{title} / {heading}");
        }
    }

    [Fact]
    public async Task Questions_DoNotMentionAnyFabricatedDoc()
    {
        var items = await Create().BuildAsync("member", "工程部", 7);
        var real = RealDocFiles().Keys.ToHashSet(StringComparer.Ordinal);

        foreach (var s in items)
            foreach (Match m in Regex.Matches(s.Text, "《(.+?)》"))
                Assert.Contains(m.Groups[1].Value, real);
    }

    [Fact]
    public void CandidateDocs_FollowKnowledgeAcl()
    {
        var member = Create().CandidateDocPaths("member", "电子部", 9);
        Assert.Contains("电子部/电子部规范.md", member);
        Assert.Contains("公共/参考资料/物料管理规范.md", member);
        Assert.DoesNotContain(member, p => p.StartsWith("工程部/"));

        var admin = Create().CandidateDocPaths("admin", null, 1);
        Assert.Contains("工程部/工程部安全须知.md", admin);
    }

    [Fact]
    public async Task Acl_MemberNeverSeesOtherDepartmentQuestions()
    {
        var items = await Create().BuildAsync("member", "电子部", 9);

        Assert.DoesNotContain(items, s => s.Text.Contains("工程部"));
        Assert.Contains(items, s => s.Kind == "study" && s.Text == "电子部怎么学？");
    }

    [Fact]
    public async Task Admin_HasNoStudyQuestion_ButSeesDepartmentDocs()
    {
        var items = await Create().BuildAsync("admin", null, 1);

        Assert.DoesNotContain(items, s => s.Kind == "study");            // 管理员没有部门
        Assert.Contains("工程部/工程部安全须知.md", Create().CandidateDocPaths("admin", null, 1));
        Assert.Equal(4, items.Count);                                    // 文档题补足 4 条
    }

    [Fact]
    public async Task MaterialQuestion_SuppressedWhenFewerThanThreeItems()
    {
        foreach (var item in Db.InventoryItems) Db.InventoryItems.Remove(item);
        Db.InventoryItems.Add(Real("测试1", "EL-LIPO-6S-2026-0001", 0));   // 线上现状：只有 1 件占位数据
        await Db.SaveChangesAsync();

        var items = await Create().BuildAsync("member", "工程部", 7);

        Assert.DoesNotContain(items, s => s.Text.Contains("还剩多少"));      // 守门：不把占位数据当建议
        Assert.Contains(items, s => s.Text == "「1030 库房」的货架分布？");   // 房间题照出
    }

    [Fact]
    public async Task RoomQuestion_ComesFromRealLayoutEvenWhenNoItems()
    {
        foreach (var item in Db.InventoryItems) Db.InventoryItems.Remove(item);
        await Db.SaveChangesAsync();

        var items = await Create().BuildAsync("member", "电子部", 9);

        Assert.Contains(items, s => s.Kind == "inventory" && s.Text == "「1030 库房」的货架分布？");
    }
}
