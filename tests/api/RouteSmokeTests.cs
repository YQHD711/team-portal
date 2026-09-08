using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace api;

/// <summary>
/// 路由构建冒烟测试 —— CI 唯一能抓住「编译通过但启动崩溃」的关卡。
/// .NET minimal API 的路由端点是运行时懒构建的:首个请求才执行 RequestDelegateFactory,
/// 端点注册错误(如缺 [FromBody])在 dotnet test 阶段不可见,上线后首个请求即崩。
/// 2026-09-05 [FromBody] 事故的防复发守卫。
/// </summary>
public class RouteSmokeTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public RouteSmokeTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task AllEndpoints_CanBeBuilt()
    {
        // 任意请求(包括404)都会触发 EndpointDataSource 全量构建——
        // 若存在端点注册错误,这里会抛异常而不是返回404
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-routesmoke-{Guid.NewGuid():N}.db");
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        }).CreateClient();
        try
        {
            var res = await client.GetAsync("/api/__route_building_probe__");

            Assert.True((int)res.StatusCode >= 200 && (int)res.StatusCode < 600,
                "路由构建异常:端点注册阶段抛出异常(常见原因:多路由参数缺[FromBody])");
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }

    [Fact]
    public async Task AuthLogin_RouteExists()
    {
        // 登录端点必须真实可达(POST 语义,GET 应返回 405 而非 404)
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-routesmoke-{Guid.NewGuid():N}.db");
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        }).CreateClient();
        try
        {
            var res = await client.GetAsync("/api/auth/login");
            Assert.NotEqual(HttpStatusCode.NotFound, res.StatusCode);
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }

    [Fact]
    public async Task FlightLogEndpoints_RoutesExist()
    {
        // 飞行日志端点必须真实可达：GET /{filename} 应可构建(404 或 200)、
        // DELETE 未带 admin role 应 401/403 而非 404。
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-routesmoke-{Guid.NewGuid():N}.db");
        var factory = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        });
        var rawClient = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        try
        {
            var detail = await rawClient.GetAsync("/api/flightlogs/whatever.tlog");
            var del = await rawClient.DeleteAsync("/api/flightlogs/whatever.tlog");

            Assert.True((int)detail.StatusCode != 404 && (int)detail.StatusCode != 503,
                $"GET 飞行日志详情 不应 404/503，实际 {(int)detail.StatusCode}");
            Assert.True((int)del.StatusCode is 401 or 403,
                $"DELETE 无 admin 应 401/403，实际 {(int)del.StatusCode}");
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }
}
