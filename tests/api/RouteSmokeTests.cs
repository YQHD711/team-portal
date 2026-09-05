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
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/__route_building_probe__");

        Assert.NotEqual(HttpStatusCode.ConnectionReset, res.StatusCode);
        Assert.True((int)res.StatusCode >= 200 && (int)res.StatusCode < 600,
            "路由构建异常:端点注册阶段抛出异常(常见原因:多路由参数缺[FromBody])");
    }

    [Fact]
    public async Task AuthLogin_RouteExists()
    {
        // 登录端点必须真实可达(POST 语义,GET 应返回 405 而非 404)
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/auth/login");
        Assert.NotEqual(HttpStatusCode.NotFound, res.StatusCode);
    }
}
