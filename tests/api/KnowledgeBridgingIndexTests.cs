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
/// P0-1 桥接索引任务：只给英文文档生成 sidecar、增量（mtime）不重复烧 token、
/// 失败重试 2 次后跳过、并发 1、AI 未配置不调用。
/// </summary>
public class KnowledgeBridgingIndexTests : IDisposable
{
    private const string Summary = "{\"t\":\"导航TECS\",\"k\":[\"盘旋半径\",\"TECS\",\"滚转角\"],\"d\":\"说明盘旋半径由什么决定\"}";
    private const string EnglishDoc = "TECS circle radius is determined by bank angle and groundspeed. " +
        "The navigation controller limits bank angle to protect the airframe and keeps the turn coordinated. " +
        "When the vehicle enters a loiter, the target bank angle is chosen from the demanded turn radius and the " +
        "current groundspeed; throttle is then adjusted to hold altitude while the pitch channel tracks the demand.";

    private readonly string _kbDir;
    private readonly AppDbContext _db;
    private readonly IConfigurationRoot _config;

    public KnowledgeBridgingIndexTests()
    {
        _kbDir = Path.Combine(Path.GetTempPath(), $"tp-bridge-run-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(_kbDir, "公共"));
        var source = Path.Combine(_kbDir, "公共", "plane.md");
        File.WriteAllText(source, EnglishDoc);
        File.SetLastWriteTimeUtc(source, DateTime.UtcNow.AddMinutes(-5));   // 保证新写的 sidecar 一定更新
        File.WriteAllText(Path.Combine(_kbDir, "公共", "中文.md"), "盘旋半径由滚转角和地速决定，这是中文文档，不需要桥接。");

        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        _db.Database.EnsureCreated();
        _config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = _kbDir })
            .Build();
    }

    public void Dispose()
    {
        try { Directory.Delete(_kbDir, true); } catch { /* best-effort */ }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private string SidecarPath => Path.Combine(_kbDir, "公共", "plane.md.zhidx.json");

    private KnowledgeBridgingIndexService CreateService(StubHttpHandler stub, string apiKey = "sk-test")
    {
        _db.SystemSettings.AddRange(
            new SystemSetting { Key = "AI:ApiKey", Value = apiKey, Category = "AI 服务", Description = "" },
            new SystemSetting { Key = "AI:BaseUrl", Value = "https://api.deepseek.com", Category = "AI 服务", Description = "" },
            new SystemSetting { Key = "AI:ModelName", Value = "deepseek-flash", Category = "AI 服务", Description = "" },
            new SystemSetting { Key = "AI:EnableThinking", Value = "false", Category = "AI 服务", Description = "" });
        _db.SaveChanges();

        var ai = new AiClient(new HttpClient(stub),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
            new SettingsService(new TestScopeFactory(_db)));
        return new KnowledgeBridgingIndexService(new AiScopeFactory(_db, ai), _config,
            NullLogger<KnowledgeBridgingIndexService>.Instance, new NullLogService(new TestScopeFactory(_db)));
    }

    private static HttpResponseMessage ChatReply(string content) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { choices = new[] { new { message = new { content } } } }),
                Encoding.UTF8, "application/json"),
        };

    [Fact]
    public async Task RunAsync_WritesChineseSidecar_ForEnglishDocsOnly()
    {
        var stub = new StubHttpHandler(_ => ChatReply(Summary));
        var service = CreateService(stub);

        var result = await service.RunAsync(force: false);

        Assert.True(result.Ok, result.Message);
        Assert.Equal(1, result.Processed);            // 只有英文那篇
        Assert.Equal(0, result.Failed);
        Assert.Equal(1, stub.Calls);                  // 一篇一次 AI 调用
        Assert.True(File.Exists(SidecarPath));
        Assert.False(File.Exists(Path.Combine(_kbDir, "公共", "中文.md.zhidx.json")));

        var json = KnowledgeBridge.TryReadIndexText(SidecarPath);
        Assert.NotNull(json);
        Assert.Contains("导航TECS", json);
        Assert.Contains("盘旋半径", json);
        Assert.Equal("公共/plane.md", KnowledgeBridge.TryReadSourcePath(SidecarPath));   // sidecar 里记着原文路径
    }

    [Fact]
    public async Task RunAsync_SecondRun_IsIncremental_AndBurnsNoTokens()
    {
        var stub = new StubHttpHandler(_ => ChatReply(Summary));
        var service = CreateService(stub);

        Assert.True((await service.RunAsync(force: false)).Ok);
        var second = await service.RunAsync(force: false);

        Assert.True(second.Ok, second.Message);
        Assert.Equal(0, second.Processed);
        Assert.Equal(1, stub.Calls);                  // 增量：第二次一次 AI 都没调
    }

    [Fact]
    public async Task RunAsync_TouchingSourceDoc_MakesItPendingAgain()
    {
        var stub = new StubHttpHandler(_ => ChatReply(Summary));
        var service = CreateService(stub);
        await service.RunAsync(force: false);

        var source = Path.Combine(_kbDir, "公共", "plane.md");
        File.SetLastWriteTimeUtc(source, DateTime.UtcNow.AddMinutes(5));   // 原文更新了

        var second = await service.RunAsync(force: false);

        Assert.Equal(1, second.Processed);
        Assert.Equal(2, stub.Calls);
    }

    [Fact]
    public async Task RunAsync_AiFailure_RetriesTwiceThenSkipsWithoutSidecar()
    {
        var stub = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = CreateService(stub);

        var result = await service.RunAsync(force: false);

        Assert.True(result.Ok, result.Message);       // 单篇失败不影响整轮
        Assert.Equal(0, result.Processed);
        Assert.Equal(1, result.Failed);
        Assert.Equal(1 + KnowledgeBridgingIndexService.MaxRetries, stub.Calls);   // 首次 + 重试 2 次
        Assert.False(File.Exists(SidecarPath));
        Assert.Contains("失败", service.Status().LastMessage);
    }

    [Fact]
    public async Task RunAsync_WithoutApiKey_DoesNotTouchAiOrDisk()
    {
        var stub = new StubHttpHandler(_ => ChatReply(Summary));
        var service = CreateService(stub, apiKey: "");

        var result = await service.RunAsync(force: false);

        Assert.False(result.Ok);
        Assert.Contains("AI 未配置", result.Message);
        Assert.Equal(0, stub.Calls);
        Assert.False(File.Exists(SidecarPath));
    }

    [Fact]
    public async Task RunAsync_ProcessesEveryPendingEnglishDoc_AndCapIs300()
    {
        File.WriteAllText(Path.Combine(_kbDir, "公共", "nav.md"), EnglishDoc + " Additional navigation notes for the autopilot.");
        File.WriteAllText(Path.Combine(_kbDir, "公共", "tecs.md"), EnglishDoc + " Throttle and pitch coordination notes.");
        var stub = new StubHttpHandler(_ => ChatReply(Summary));
        var service = CreateService(stub);

        var result = await service.RunAsync(force: false);

        Assert.Equal(3, result.Processed);   // 3 篇英文各一
        Assert.Equal(3, stub.Calls);
        Assert.Equal(0, result.Failed);
        Assert.Equal(300, KnowledgeBridgingIndexService.MaxDocsPerRun);   // 规格硬上限
    }

    [Fact]
    public async Task RunAsync_IsExclusive_SecondCallIsRejectedWhileFirstRuns()
    {
        using var gate = new ManualResetEventSlim(false);
        var stub = new StubHttpHandler(_ => { gate.Wait(5000); return ChatReply(Summary); });
        var service = CreateService(stub);

        var first = service.RunAsync(force: false);
        await WaitUntilAsync(() => stub.Calls >= 1);

        var second = await service.RunAsync(force: false);
        Assert.False(second.Ok);
        Assert.Contains("已有一次", second.Message);

        gate.Set();
        Assert.True((await first).Ok);
        Assert.Equal(1, stub.Calls);
    }

    private static async Task WaitUntilAsync(Func<bool> condition, int timeoutMs = 5000)
    {
        var start = Environment.TickCount64;
        while (!condition() && Environment.TickCount64 - start < timeoutMs)
            await Task.Delay(20);
        Assert.True(condition(), "等待条件超时");
    }

    /// <summary>测试专用 scope：同时提供 AppDbContext 与构造好的 AiClient（生产里 AiClient 走 DI）。</summary>
    private sealed class AiScopeFactory : IServiceScopeFactory
    {
        private readonly AppDbContext _db;
        private readonly AiClient _ai;
        public AiScopeFactory(AppDbContext db, AiClient ai) { _db = db; _ai = ai; }

        public IServiceScope CreateScope()
        {
            var services = new ServiceCollection();
            services.AddSingleton(_db);
            services.AddSingleton(_ai);
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
