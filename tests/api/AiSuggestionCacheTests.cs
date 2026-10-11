using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-14 A 的稳定性：空知识库不能 500（要返回空表），且缓存要真的省掉重复读盘 ——
/// 这个接口每次打开聊天页都会调。
/// </summary>
public class AiSuggestionCacheTests : AiSuggestionTestBase
{
    [Fact]
    public async Task EmptyKnowledgeBaseAndNoLayouts_ReturnsEmptyList()
    {
        var empty = Path.Combine(Path.GetTempPath(), $"tp-suggest-empty-{Guid.NewGuid():N}");
        Directory.CreateDirectory(empty);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = empty }).Build();
        var scopes = new TestScopeFactory(Db);
        var svc = new AiSuggestionService(new KnowledgeService(config, new NullLogService(scopes), scopes), Db,
            NullLogger<AiSuggestionService>.Instance);
        foreach (var layout in Db.StorageLayouts) Db.StorageLayouts.Remove(layout);
        foreach (var item in Db.InventoryItems) Db.InventoryItems.Remove(item);
        await Db.SaveChangesAsync();

        Assert.Empty(await svc.BuildAsync("member", "工程部", 7));
        Directory.Delete(empty, true);
    }

    [Fact]
    public async Task Cache_SecondCallDoesNotReadDiskAgain()
    {
        var first = Create();
        await first.BuildAsync("member", "工程部", 42);
        Assert.True(first.FilesRead > 0, "第一次应该真的读了文档");

        var second = Create();   // 新实例命中同一个静态缓存（键含 role/dept/uid/知识库路径）
        var items = await second.BuildAsync("member", "工程部", 42);

        Assert.Equal(0, second.FilesRead);   // 命中缓存 → 一次盘都没读
        Assert.NotEmpty(items);
    }

    [Fact]
    public async Task CacheKey_IsolatesDifferentUsers()
    {
        // 同一台机器上不同用户不能拿到彼此的建议（uid 进键；部门不同时内容也不同）
        var a = await Create().BuildAsync("member", "工程部", 1);
        var b = await Create().BuildAsync("member", "电子部", 2);

        Assert.Contains(a, s => s.Text == "工程部怎么学？");
        Assert.Contains(b, s => s.Text == "电子部怎么学？");
        Assert.DoesNotContain(b, s => s.Text.Contains("工程部"));
    }
}
