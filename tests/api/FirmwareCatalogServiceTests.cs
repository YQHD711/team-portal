using System.Net;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 固件目录服务：SSRF 面（路径段白名单 + 「必须能在目录里查到」）与目录缓存行为。
/// 用假 HttpMessageHandler 驱动，全部离线可跑。
/// </summary>
public class FirmwareCatalogServiceTests
{
    private const string PlaneVersionsHtml = """
        <table>
        <tr bgcolor="#ffffff"><td align=center><img src="/icons/back.gif"></td><td><a href="/"><b>Parent Directory</B> </a></td>
        	<td>--</td><td>--</td>

        <tr><td align=center><img src="/icons/folder.gif"></td><td><a href="/Plane/beta">beta</A></td><td>--</td><td>--</td></tr>
        <tr><td align=center><img src="/icons/folder.gif"></td><td><a href="/Plane/stable">stable</A></td><td>--</td><td>--</td></tr>
        </table>
        """;

    private const string PlaneBoardsHtml = """
        <table>
        <tr bgcolor="#ffffff"><td align=center><img src="/icons/back.gif"></td><td><a href="/Plane"><b>Parent Directory</B> </a></td>
        	<td>--</td><td>--</td>

        <tr><td align=center><img src="/icons/folder.gif"></td><td><a href="/Plane/stable/Pixhawk6X">Pixhawk6X</A></td><td>--</td><td>--</td></tr>
        <tr><td align=center><img src="/icons/folder.gif"></td><td><a href="/Plane/stable/CubeOrange">CubeOrange</A></td><td>--</td><td>--</td></tr>
        </table>
        """;

    private const string BoardFilesHtml = """
        <table>
        <tr><td align=center><img src="/icons/text.gif"></td><td><a href="/Plane/stable/Pixhawk6X/arduplane.apj">arduplane.apj</a></td><td>Thu</td><td>1538295</td></tr>
        <tr><td align=center><img src="/icons/text.gif"></td><td><a href="/Plane/stable/Pixhawk6X/arduplane_with_bl.hex">arduplane_with_bl.hex</a></td><td>Thu</td><td>4966108</td></tr>
        <tr><td align=center><img src="/icons/text.gif"></td><td><a href="/Plane/stable/Pixhawk6X/firmware-version.txt">firmware-version.txt</a></td><td>Thu</td><td>37</td></tr>
        </table>
        """;

    private const string Px4JsonOk = """
        [ { "tag_name": "v1.17.0", "name": "v1.17.0", "prerelease": false, "assets": [
            { "name": "px4_fmu-v6x_default.px4", "size": 1800000, "browser_download_url": "https://github.com/PX4/PX4-Autopilot/releases/download/v1.17.0/px4_fmu-v6x_default.px4" } ] } ]
        """;

    private const string Px4JsonEvilHost = """
        [ { "tag_name": "v1.17.0", "name": "v1.17.0", "prerelease": false, "assets": [
            { "name": "px4_fmu-v6x_default.px4", "size": 1800000, "browser_download_url": "https://evil.example.com/px4_fmu-v6x_default.px4" } ] } ]
        """;

    private static HttpResponseMessage Html(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, System.Text.Encoding.UTF8, "text/html")
    };

    /// <summary>按 URL 路径分发的假上游；未登记路径一律 404。</summary>
    private static Func<HttpRequestMessage, HttpResponseMessage> ArduPilotStub() => req =>
    {
        var path = req.RequestUri!.AbsolutePath;
        return path switch
        {
            "/Plane/" => Html(PlaneVersionsHtml),
            "/Plane/stable/" => Html(PlaneBoardsHtml),
            "/Plane/stable/Pixhawk6X/" => Html(BoardFilesHtml),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        };
    };

    private static (FirmwareCatalogService Svc, StubHttpHandler Handler) Build(
        Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        var handler = new StubHttpHandler(responder);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Firmware:ArduPilotBase"] = "https://firmware.ardupilot.org",
                ["Firmware:Px4ReleasesApi"] = "https://api.github.com/repos/PX4/PX4-Autopilot/releases",
            })
            .Build();

        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();

        var svc = new FirmwareCatalogService(
            new HttpClient(handler),
            new MemoryCache(new MemoryCacheOptions()),
            config,
            new NullLogService(new TestScopeFactory(db)));

        return (svc, handler);
    }

    [Fact]
    public async Task Resolve_ArduPilot_BuildsOfficialUrlFromCatalog()
    {
        var (svc, _) = Build(ArduPilotStub());

        var target = await svc.ResolveAsync("ardupilot", "Plane", "stable", "Pixhawk6X", "arduplane.apj");

        Assert.NotNull(target);
        Assert.Equal("https://firmware.ardupilot.org/Plane/stable/Pixhawk6X/arduplane.apj", target!.Url);
        Assert.Equal("arduplane.apj", target.FileName);
        Assert.Equal(1538295, target.Asset.Size);
    }

    [Fact]
    public async Task Resolve_RejectsTraversalSegments_WithoutAnyUpstreamRequest()
    {
        var (svc, handler) = Build(ArduPilotStub());

        var attempts = new[]
        {
            await svc.ResolveAsync("ardupilot", "Plane", "../../../etc", "Pixhawk6X", "arduplane.apj"),
            await svc.ResolveAsync("ardupilot", "Plane", "stable", "../../../etc", "arduplane.apj"),
            await svc.ResolveAsync("ardupilot", "Plane", "stable", "Pixhawk6X", "../../../../etc/passwd"),
            await svc.ResolveAsync("ardupilot", "../../etc", "stable", "Pixhawk6X", "arduplane.apj"),
            await svc.ResolveAsync("ardupilot", "Plane", "evil.com/x", "Pixhawk6X", "arduplane.apj"),
            // 没有斜杠的 .. 只能靠路径段白名单挡（其余非法形态先被字符白名单拦下）
            await svc.ResolveAsync("ardupilot", "Plane", "stable", "..", "arduplane.apj"),
            await svc.ResolveAsync("ardupilot", "Plane", "stable", "Pixhawk6X", ".."),
        };

        Assert.All(attempts, Assert.Null);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Resolve_RejectsUnknownVehicleAndUnknownSource()
    {
        var (svc, handler) = Build(ArduPilotStub());

        Assert.Null(await svc.ResolveAsync("ardupilot", "Tools", "stable", "Pixhawk6X", "arduplane.apj"));
        Assert.Null(await svc.ResolveAsync("ardupilot", null, "stable", "Pixhawk6X", "arduplane.apj"));
        Assert.Null(await svc.ResolveAsync("http://evil.com", "Plane", "stable", "Pixhawk6X", "arduplane.apj"));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Resolve_RejectsAssetThatIsNotInTheListing()
    {
        var (svc, _) = Build(ArduPilotStub());

        // 目录里确实存在的板子，但文件名是编造的 → 不能拿到 URL
        Assert.Null(await svc.ResolveAsync("ardupilot", "Plane", "stable", "Pixhawk6X", "evil.sh"));
        // 文件名存在但板子不存在 → 上游 404 → null
        Assert.Null(await svc.ResolveAsync("ardupilot", "Plane", "stable", "NotABoard", "arduplane.apj"));
    }

    [Fact]
    public async Task Resolve_Px4_TakesAssetUrlFromRelease()
    {
        var (svc, _) = Build(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(Px4JsonOk, System.Text.Encoding.UTF8, "application/json")
        });

        var target = await svc.ResolveAsync("px4", null, "v1.17.0", "px4_fmu-v6x_default", "px4_fmu-v6x_default.px4");

        Assert.NotNull(target);
        Assert.Equal("https://github.com/PX4/PX4-Autopilot/releases/download/v1.17.0/px4_fmu-v6x_default.px4", target!.Url);
    }

    [Fact]
    public async Task Resolve_Px4_RejectsUntrustedDownloadHost()
    {
        var (svc, _) = Build(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(Px4JsonEvilHost, System.Text.Encoding.UTF8, "application/json")
        });

        Assert.Null(await svc.ResolveAsync("px4", null, "v1.17.0", "px4_fmu-v6x_default", "px4_fmu-v6x_default.px4"));
    }

    [Fact]
    public async Task Catalog_IsServedFromCacheOnSecondCall()
    {
        var (svc, handler) = Build(ArduPilotStub());

        var first = await svc.GetVersionsAsync("ardupilot", "Plane");
        var second = await svc.GetVersionsAsync("ardupilot", "Plane");

        Assert.Equal(2, first!.Count);
        Assert.Equal(new[] { "stable", "beta" }, second!.Select(v => v.Id));
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Catalog_UpstreamFailure_ReturnsNull_AndIsNotCached()
    {
        var (svc, handler) = Build(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));

        Assert.Null(await svc.GetVersionsAsync("ardupilot", "Plane"));
        Assert.Null(await svc.GetVersionsAsync("ardupilot", "Plane"));

        // 失败不写缓存 → 两次都真的去问上游（避免一次抖动被固化 30 分钟）
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task Assets_ExcludeNonFirmwareFiles()
    {
        var (svc, _) = Build(ArduPilotStub());

        var assets = await svc.GetAssetsAsync("ardupilot", "Plane", "stable", "Pixhawk6X");

        Assert.Equal(2, assets!.Count);
        Assert.DoesNotContain(assets, a => a.Name.EndsWith(".txt"));
    }

    /// <summary>回归：.NET HttpClient 默认不发 User-Agent，GitHub REST API 会直接 403
    /// （"Request forbidden by administrative rules"）。PX4 目录必须自带 UA 与 GitHub Accept 头。</summary>
    [Fact]
    public async Task UpstreamRequests_AlwaysCarryUserAgent()
    {
        var (arduPilot, apHandler) = Build(ArduPilotStub());
        await arduPilot.GetVersionsAsync("ardupilot", "Plane");

        var (px4, px4Handler) = Build(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(Px4JsonOk, System.Text.Encoding.UTF8, "application/json")
        });
        await px4.GetVersionsAsync("px4", null);

        Assert.All(apHandler.UserAgents, ua => Assert.Contains("TeamPortal-Firmware", ua));
        Assert.All(px4Handler.UserAgents, ua => Assert.Contains("TeamPortal-Firmware", ua));
        Assert.All(px4Handler.Accepts, accept => Assert.Contains("application/vnd.github+json", accept));
    }

    [Fact]
    public async Task Boards_KeepFirstBoardAfterUnclosedParentRow()
    {
        var (svc, _) = Build(ArduPilotStub());

        var boards = await svc.GetBoardsAsync("ardupilot", "Plane", "stable");

        Assert.Equal(new[] { "Pixhawk6X", "CubeOrange" }, boards!.Select(b => b.Name));
    }
}

/// <summary>记录调用次数、URL 与请求头的假上游处理器。</summary>
internal sealed class StubHttpHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

    public StubHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

    public int Calls { get; private set; }
    public List<string> Urls { get; } = [];
    /// <summary>请求头在 HttpRequestMessage 释放后读不到，所以在处理时就抄下来。</summary>
    public List<string> UserAgents { get; } = [];
    public List<string> Accepts { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        Urls.Add(request.RequestUri!.ToString());
        UserAgents.Add(request.Headers.UserAgent.ToString());
        Accepts.Add(request.Headers.Accept.ToString());
        return Task.FromResult(_responder(request));
    }
}
