using System.Net;
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
/// task-16 聊天工具循环的公共夹具。
///
/// **不真调 DeepSeek**：<see cref="ScriptedAiHandler"/> 按脚本吐 OpenAI 兼容的假响应（工具调用 / 直接作答 / SSE），
/// 并记录每一轮真实发出的请求体，用来断言"工具结果进了后续消息""V4 的 reasoning_content 被回传"
/// "最后一轮才 stream 且不带 tools""轮数上限生效"。整条链路（AiClient 拼包 → AiProxyService 循环）都是真的。
/// </summary>
public abstract class AgenticChatTestBase : IDisposable
{
    protected readonly string Root;
    protected readonly string KbDir;
    protected readonly string DbPath;
    protected readonly SettingsService Settings;
    protected readonly ScriptedAiHandler Handler = new();
    protected readonly AiProxyService Proxy;
    protected readonly LogService Log;
    protected readonly AppDbContext Db;
    private readonly FileScopes _scopes;

    protected AgenticChatTestBase()
    {
        Root = Path.Combine(Path.GetTempPath(), $"tp-agent-{Guid.NewGuid():N}");
        KbDir = Path.Combine(Root, "knowledge");
        Directory.CreateDirectory(Path.Combine(KbDir, "公共"));
        File.WriteAllText(Path.Combine(KbDir, "公共", "2025年航协年终总结.md"),
            "2025 年度训练与比赛成绩记录：全年飞行 128 架次，获省级一等奖。");
        DbPath = Path.Combine(Root, "agent.db");
        _scopes = new FileScopes(DbPath);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = KbDir }).Build();
        Settings = new SettingsService(_scopes);
        Seed("AI:ApiKey", "sk-test");
        Seed("AI:BaseUrl", "https://api.deepseek.com");
        Seed("AI:ModelName", "deepseek-flash");
        Seed("AI:MaxToolRounds", "4");
        Settings.ClearCache();

        Db = new AppDbContext(Options());
        Db.Database.EnsureCreated();
        Log = new LogService(_scopes, NullLogger<LogService>.Instance, Settings);
        var ai = new AiClient(new HttpClient(Handler), config, Settings);
        var search = new KnowledgeSearchService(config, NullLogger<KnowledgeSearchService>.Instance, _scopes, Log);
        var knowledge = new KnowledgeService(config, Log, _scopes);
        Proxy = new AiProxyService(ai, Settings, search, knowledge, Log, Db);
    }

    public void Dispose()
    {
        try { SqliteConnection.ClearAllPools(); } catch { }
        try { Directory.Delete(Root, true); } catch { /* best-effort */ }
        Db.Dispose();
        GC.SuppressFinalize(this);
    }

    protected DbContextOptions<AppDbContext> Options() =>
        new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={DbPath}").Options;

    protected void Seed(string key, string value)
    {
        using var db = new AppDbContext(Options());
        db.Database.EnsureCreated();
        var row = db.SystemSettings.FirstOrDefault(s => s.Key == key);
        if (row is null)
            db.SystemSettings.Add(new SystemSetting { Key = key, Value = value, Category = "AI 服务", Description = "" });
        else row.Value = value;
        db.SaveChanges();
    }

    // ── 假模型响应 ──

    protected static string ToolCall(string id, string name, string args, string? content = "我再看一眼", string? reasoning = "现有资料不够")
        => JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content, reasoning_content = reasoning,
                        tool_calls = new[] { new { id, type = "function", function = new { name, arguments = args } } },
                    }
                }
            }
        });

    protected static string Answer(string content = "答案是……") =>
        JsonSerializer.Serialize(new { choices = new[] { new { message = new { content } } } });

    protected const string Sse = "data: {\"choices\":[{\"delta\":{\"content\":\"最终回答\"}}]}\n\ndata: [DONE]\n\n";

    protected static bool Has(string body, string property)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.TryGetProperty(property, out _);
    }

    /// <summary>取某一轮请求里的消息（role → content），断言"工具结果进了后续轮次"用。</summary>
    protected static List<(string Role, string Content)> Messages(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("messages").EnumerateArray()
            .Select(m => (m.TryGetProperty("role", out var r) ? r.GetString() ?? "" : "",
                m.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() ?? "" : ""))
            .ToList();
    }

    protected static bool IsStream(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("stream").GetBoolean();
    }

    protected static string SearchArgs(string query = "年终总结 训练 成绩") =>
        JsonSerializer.Serialize(new { query, top_k = 5 });

    protected async Task<string> WaitForLogAsync(string prefix, int timeoutMs = 8000)
    {
        var start = Environment.TickCount64;
        while (Environment.TickCount64 - start < timeoutMs)
        {
            using var db = new AppDbContext(Options());
            var row = await db.SystemLogs.Where(l => l.Category == RagLog.Category && l.Message.StartsWith(prefix))
                .OrderByDescending(l => l.Id).FirstOrDefaultAsync();
            if (row is not null) return row.Message;
            await Task.Delay(150);
        }
        return "";
    }

    /// <summary>每个 scope 开一个新连接（LogService 后台批量写库需要独立连接）。</summary>
    private sealed class FileScopes : IServiceScopeFactory
    {
        private readonly string _dbPath;
        public FileScopes(string dbPath) => _dbPath = dbPath;

        public IServiceScope CreateScope()
        {
            var services = new ServiceCollection();
            services.AddDbContext<AppDbContext>(o => o.UseSqlite($"Data Source={_dbPath}"));
            return services.BuildServiceProvider().CreateScope();
        }
    }

    /// <summary>按脚本返回假响应的上游；同时记录每一轮真实请求体。</summary>
    protected sealed class ScriptedAiHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpResponseMessage>> _script = new();
        public List<string> Bodies { get; } = [];

        public void Enqueue(string body) => _script.Enqueue(() => Ok(body));
        public void EnqueueRaw(string body) => _script.Enqueue(() => Ok(body));
        public void EnqueueStatus(HttpStatusCode status, string body) =>
            _script.Enqueue(() => new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            return _script.Count > 0 ? _script.Dequeue()() : Ok(Sse);
        }

        private static HttpResponseMessage Ok(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }
}
