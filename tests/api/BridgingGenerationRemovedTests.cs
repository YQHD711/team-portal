using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace api;

/// <summary>
/// task-13 核心验收：摘要生成能力**彻底移除**，不是"存在但关着"。
///   - 手动触发与进度端点在路由表里不存在（404）；
///   - 没有任何 hosted service 在做桥接生成 —— 也就是不再存在"等过一个调度周期就会调 AI"的东西。
/// 读取/索引侧仍然保留（见 KnowledgeBridgeSearchTests：已有 sidecar 依旧参与检索）。
/// </summary>
public class BridgingGenerationRemovedTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public BridgingGenerationRemovedTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private WebApplicationFactory<Program> Host(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
    });

    private static string NewDbPath() => Path.Combine(Path.GetTempPath(), $"tp-nobridge-{Guid.NewGuid():N}.db");

    [Fact]
    public async Task BridgingGenerationEndpoints_DoNotExist()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = Host(dbPath).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            var run = await client.PostAsync("/api/admin/knowledge/bridging/run", null);
            var status = await client.GetAsync("/api/admin/knowledge/bridging/status");

            Assert.Equal(HttpStatusCode.NotFound, run.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, status.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public void NoHostedService_DoesBridgingGeneration()
    {
        var dbPath = NewDbPath();
        try
        {
            var factory = Host(dbPath);
            var hosted = factory.Services.GetServices<IHostedService>().Select(h => h.GetType().Name).ToList();

            // 反向锚定：已知的两个后台任务必须还在（否则"没有桥接任务"可能只是"什么任务都没有"而假过）
            Assert.Contains("WikiProcessingWorker", hosted);
            Assert.Contains("MaintenanceWorker", hosted);
            Assert.DoesNotContain(hosted, name => name.Contains("Bridging", StringComparison.OrdinalIgnoreCase));
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
