using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-16 的只读检索工具（<c>KnowledgeToolSession</c>）：分页读长文档、ACL、越界防护、字符预算。
/// 这些是模型在工具轮里真正调到的东西，全在本地跑，不碰 AI。
/// </summary>
public class KnowledgeToolTests : IDisposable
{
    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly KnowledgeSearchService _search;
    private readonly KnowledgeService _knowledge;
    private readonly string _longDoc;

    public KnowledgeToolTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-tools-{Guid.NewGuid():N}");
        _longDoc = string.Join("\n", Enumerable.Range(1, 1400).Select(i => $"第{i}段：年度训练与比赛情况记录（甲乙丙丁戊己庚辛）"))
                   + "\n结尾标记：最后一段是经费与展望。";
        Write("公共/2025年航协年终总结.md", _longDoc);
        Write("公共/物料管理规范.md", "# 物料管理规范\n\nB 级物料需部长审批，C 级直接领用。\n");
        Write("工程部/工程部规范.md", "工程部内部规范：试飞安全与跑道管理。\n");
        Write("电子部/电子部规范.md", "电子部内部规范：焊接流程与防静电。\n");

        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir }).Build();
        var scopes = new TestScopeFactory(_db);
        var log = new NullLogService(scopes);
        _search = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance, scopes, log);
        _knowledge = new KnowledgeService(config, log, scopes);
    }

    public void Dispose()
    {
        _search.Dispose();
        try { Directory.Delete(_kbDir, true); } catch { /* best-effort */ }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private void Write(string rel, string content)
    {
        var full = Path.Combine(_kbDir, rel.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }

    private KnowledgeToolSession Session(string? role = "admin", string? dept = null) =>
        new(_search, _knowledge, role, dept, 1);

    private static string Call(KnowledgeToolSession session, string tool, string args) =>
        session.Execute(tool, args);

    [Fact]
    public void ReadDocument_PagesThroughWholeLongDocument()
    {
        var session = Session();
        var pages = new List<string>();
        var offset = 0;
        var total = 0;
        var hasMore = true;

        while (hasMore && pages.Count < 10)
        {
            using var doc = System.Text.Json.JsonDocument.Parse(
                Call(session, "read_document", $"{{\"path\":\"公共/2025年航协年终总结.md\",\"offset\":{offset},\"length\":8000}}"));
            var root = doc.RootElement;
            Assert.True(root.GetProperty("totalChars").GetInt32() > 30000, "文档应该有 3 万字以上");
            total = root.GetProperty("totalChars").GetInt32();
            Assert.Equal(offset, root.GetProperty("offset").GetInt32());
            pages.Add(root.GetProperty("content").GetString()!);
            hasMore = root.GetProperty("hasMore").GetBoolean();
            offset += root.GetProperty("length").GetInt32();
        }

        Assert.True(pages.Count >= 4, "应该分成多页读完");
        Assert.Equal(total, pages.Sum(p => p.Length));                     // 跨全文，不只是开头
        Assert.Equal(_longDoc, string.Concat(pages));                      // 拼起来就是原文
        Assert.False(hasMore);
        Assert.Contains("结尾标记", pages[^1]);                             // 最后一页在文档尾部
        Assert.DoesNotContain("结尾标记", pages[0]);
    }

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("/etc/passwd")]
    [InlineData("C:/Windows/win.ini")]
    [InlineData("C:\\Windows\\win.ini")]
    [InlineData("公共/../工程部/工程部规范.md")]
    [InlineData("公共\\..\\工程部\\工程部规范.md")]
    [InlineData("../data/knowledge/公共/物料管理规范.md")]
    public void ReadDocument_RejectsTraversalAndAbsolutePaths(string path)
    {
        var raw = Call(Session("admin"), "read_document", System.Text.Json.JsonSerializer.Serialize(new { path }));

        Assert.Contains("error", raw);
        Assert.DoesNotContain("物料", raw);
        Assert.DoesNotContain("root:", raw);
    }

    [Fact]
    public void ReadDocument_RejectsOversizeLength_AndBadOffset()
    {
        var session = Session("admin");
        var path = "公共/物料管理规范.md";

        Assert.Contains("error", Call(session, "read_document", $"{{\"path\":\"{path}\",\"length\":99999}}"));
        Assert.Contains("error", Call(session, "read_document", $"{{\"path\":\"{path}\",\"length\":0}}"));
        Assert.Contains("error", Call(session, "read_document", $"{{\"path\":\"{path}\",\"offset\":-5}}"));
        Assert.Contains("error", Call(session, "read_document", $"{{\"path\":\"{path}\",\"offset\":999999}}"));
        Assert.Contains("error", Call(session, "read_document", "{\"path\":\"\"}"));
        // 正好等于上限是允许的
        Assert.DoesNotContain("error", Call(session, "read_document", $"{{\"path\":\"{path}\",\"length\":{KnowledgeToolSession.MaxPageChars}}}"));
    }

    [Fact]
    public void ReadDocument_EnforcesAcl()
    {
        var member = Session("member", "电子部");

        Assert.Contains("error", Call(member, "read_document", "{\"path\":\"工程部/工程部规范.md\"}"));
        Assert.DoesNotContain("工程部内部规范", Call(member, "read_document", "{\"path\":\"工程部/工程部规范.md\"}"));
        Assert.Contains("电子部内部规范", Call(member, "read_document", "{\"path\":\"电子部/电子部规范.md\"}"));
        Assert.Contains("物料管理规范", Call(member, "read_document", "{\"path\":\"公共/物料管理规范.md\"}"));

        Assert.Contains("工程部内部规范", Call(Session("admin"), "read_document", "{\"path\":\"工程部/工程部规范.md\"}"));
    }

    [Fact]
    public void SearchKnowledge_FollowsCallerScope()
    {
        var member = Call(Session("member", "电子部"), "search_knowledge", "{\"query\":\"规范\",\"top_k\":8}");
        Assert.Contains("电子部/电子部规范.md", member);
        Assert.DoesNotContain("工程部/工程部规范.md", member);

        var admin = Call(Session("admin"), "search_knowledge", "{\"query\":\"规范\",\"top_k\":8}");
        Assert.Contains("工程部/工程部规范.md", admin);
    }

    [Fact]
    public void UnknownToolAndBadArgs_ReturnErrors()
    {
        Assert.Contains("error", Call(Session(), "write_file", "{\"path\":\"x\"}"));
        Assert.Contains("error", Call(Session(), "search_knowledge", "{}"));
        Assert.Contains("error", Call(Session(), "read_document", "not-json"));
    }

    [Fact]
    public void Budget_StopsFeedingNewContent()
    {
        var session = Session();
        var errors = 0;

        // 反复读同一页（模型真会这么干）：满页约 8150 字符，预算 48000 → 第 6 次必被拒
        for (var i = 0; i < 8; i++)
        {
            var raw = Call(session, "read_document",
                $"{{\"path\":\"公共/2025年航协年终总结.md\",\"offset\":0,\"length\":{KnowledgeToolSession.MaxPageChars}}}");
            if (raw.Contains("error"))
            {
                errors++;
                Assert.Contains("上限", raw);
            }
        }

        Assert.True(errors >= 1, "预算用尽后必须拒绝继续给新内容");
        Assert.True(session.SpentChars <= KnowledgeToolSession.MaxTotalChars);
        Assert.True(session.SpentChars > 30000, "前几页应该真的花掉了预算");
    }
}
