using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// P0-2 写入侧端到端：聊天走一遍 RAG，SystemLogs（Category=ai）里必须出现
/// "RAG search: q=… hits=… returned=… empty=…" 与 "RAG context: chars=… used=…"，
/// 且统计端能解析出空转率。LogService 是 3 秒批量落库，所以这里轮询等它落盘。
/// </summary>
public class RagObservabilityTests : IDisposable
{
    private readonly string _root;
    private readonly string _kbDir;
    private readonly string _dbPath;
    private readonly SqliteScopeFactory _scopes;

    public RagObservabilityTests()
    {
        _root = Path.Combine(Path.GetTempPath(), $"tp-rag-{Guid.NewGuid():N}");
        _kbDir = Path.Combine(_root, "knowledge");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));
        File.WriteAllText(Path.Combine(_kbDir, "公共", "circle.md"), "盘旋半径由滚转角和地速决定，转弯时机翼需要保持协调。");
        _dbPath = Path.Combine(_root, "rag.db");
        _scopes = new SqliteScopeFactory(_dbPath);
        using var db = new AppDbContext(Options());
        db.Database.EnsureCreated();
        db.SystemSettings.AddRange(
            new SystemSetting { Key = "AI:ApiKey", Value = "sk-test", Category = "AI 服务", Description = "" },
            new SystemSetting { Key = "AI:BaseUrl", Value = "https://api.deepseek.com", Category = "AI 服务", Description = "" },
            new SystemSetting { Key = "AI:ModelName", Value = "deepseek-flash", Category = "AI 服务", Description = "" });
        db.SaveChanges();
    }

    private DbContextOptions<AppDbContext> Options() =>
        new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={_dbPath}").Options;

    public void Dispose()
    {
        try { SqliteConnection.ClearAllPools(); } catch { }
        try { Directory.Delete(_root, true); } catch { /* best-effort */ }
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Chat_EmitsRagSearchAndContextLogs_ThatStatsCanParse()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
        var settings = new SettingsService(_scopes);
        var log = new LogService(_scopes, NullLogger<LogService>.Instance, settings);
        using var search = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance, _scopes, log);
        var ai = new AiClient(new HttpClient(new StubHttpHandler(_ => ChatReply())), config, settings);
        var proxy = new AiProxyService(ai, settings, search, log);

        var stream = await proxy.ChatStream("盘旋半径由什么决定", new AiProxyService.SearchScope("admin", null, 0));
        Assert.NotNull(stream);   // RAG 链路真的跑完了（假 AI 返回 200）
        stream!.Dispose();

        var rows = await WaitForRagLogsAsync();
        var searchLine = rows.FirstOrDefault(r => r.Message.StartsWith(RagLog.SearchPrefix));
        var contextLine = rows.FirstOrDefault(r => r.Message.StartsWith(RagLog.ContextPrefix));
        Assert.NotNull(searchLine);
        Assert.NotNull(contextLine);

        Assert.True(RagLog.TryParseSearch(searchLine!.Message, out var query, out var hits, out var returned, out var empty));
        Assert.Equal("盘旋半径由什么决定", query);
        Assert.True(hits > 0);
        Assert.True(returned > 0);
        Assert.False(empty);                                   // 有命中 → 不是空转

        Assert.True(RagLog.TryParseContext(contextLine!.Message, out var chars, out var used));
        Assert.True(used >= 1);
        Assert.True(chars > 0);
    }

    [Fact]
    public async Task Stats_ReflectsTheLoggedEmptySearch()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
        var settings = new SettingsService(_scopes);
        var log = new LogService(_scopes, NullLogger<LogService>.Instance, settings);
        using var search = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance, _scopes, log);

        // 库里没有这个词 → 空结果（空转）
        search.Search("量子纠缠推进器", 5, "admin", null);
        await WaitForRagLogsAsync();

        using var db = new AppDbContext(Options());
        var stats = await new RagStatsService(db).GetAsync();

        Assert.Equal(1, stats.SearchCount);
        Assert.Equal(1, stats.EmptyCount);
        Assert.Equal(100, stats.EmptyRatePct);
        Assert.Equal("量子纠缠推进器", stats.RecentEmpty[0].Query);
    }

    private async Task<List<SystemLog>> WaitForRagLogsAsync(int timeoutMs = 12000)
    {
        var start = Environment.TickCount64;
        while (Environment.TickCount64 - start < timeoutMs)
        {
            using var db = new AppDbContext(Options());
            var rows = await db.SystemLogs.Where(l => l.Category == RagLog.Category).ToListAsync();
            if (rows.Count > 0) return rows;
            await Task.Delay(250);
        }
        return [];
    }

    private static HttpResponseMessage ChatReply()
    {
        var body = JsonSerializer.Serialize(new { choices = new[] { new { message = new { content = "好的" } } } });
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
    }

    /// <summary>每个 scope 开一个新的 AppDbContext（LogService 后台批量写库要独立连接）。</summary>
    private sealed class SqliteScopeFactory : IServiceScopeFactory
    {
        private readonly string _dbPath;
        public SqliteScopeFactory(string dbPath) => _dbPath = dbPath;

        public IServiceScope CreateScope()
        {
            var services = new ServiceCollection();
            services.AddDbContext<AppDbContext>(o => o.UseSqlite($"Data Source={_dbPath}"));
            return new ProviderScope(services.BuildServiceProvider());
        }

        private sealed class ProviderScope : IServiceScope
        {
            private readonly ServiceProvider _provider;
            public ProviderScope(ServiceProvider provider) => _provider = provider;
            public IServiceProvider ServiceProvider => _provider;
            public void Dispose() => _provider.Dispose();
        }
    }
}
