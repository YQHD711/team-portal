using System.Net;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 固件落盘缓存：命中缓存不再回源、超限拒收、失败不留半截文件、路径段不可越界。
/// 用假上游驱动，离线可跑。
/// </summary>
public class FirmwareCacheServiceTests : IDisposable
{
    private readonly string _dir;

    public FirmwareCacheServiceTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), $"tp-fwcache-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { /* best effort */ }
        GC.SuppressFinalize(this);
    }

    private FirmwareCacheService Build(StubHttpHandler handler, long maxBytes = 1_000_000)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Firmware:CacheDir"] = _dir,
                ["Firmware:MaxBytes"] = maxBytes.ToString(),
            })
            .Build();

        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        db.Database.EnsureCreated();

        return new FirmwareCacheService(
            new HttpClient(handler), config, new NullLogService(new TestScopeFactory(db)));
    }

    private static FirmwareTarget Target(string board = "Pixhawk6X", string asset = "arduplane.apj", string version = "stable")
        => new(
            FirmwareSource.ArduPilot, "Plane", version, board,
            new FirmwareAsset(asset, "apj", "APJ", 0),
            $"https://firmware.ardupilot.org/Plane/{version}/{board}/{asset}",
            asset);

    private static StubHttpHandler BytesHandler(int count) =>
        new(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[count]) });

    [Fact]
    public async Task EnsureAsync_DownloadsOnceThenServesFromDisk()
    {
        var handler = BytesHandler(128);
        var svc = Build(handler);

        var first = await svc.EnsureAsync(Target());
        var second = await svc.EnsureAsync(Target());

        Assert.NotNull(first);
        Assert.Equal(first, second);
        Assert.Equal(128, new FileInfo(first!).Length);
        Assert.Equal(1, handler.Calls);
        Assert.Equal(Path.Combine(_dir, "ardupilot", "Plane", "stable", "Pixhawk6X", "arduplane.apj"), first);
    }

    [Fact]
    public async Task EnsureAsync_RejectsBodyOverCap_AndLeavesNoPartialFile()
    {
        var svc = Build(BytesHandler(5000), maxBytes: 1024);

        Assert.Null(await svc.EnsureAsync(Target()));

        Assert.Empty(Directory.Exists(_dir) ? Directory.GetFiles(_dir, "*.apj", SearchOption.AllDirectories) : []);
        Assert.Empty(Directory.GetFiles(_dir, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task EnsureAsync_RejectsDeclaredOversizeBeforeDownloading()
    {
        var handler = new StubHttpHandler(_ =>
        {
            var content = new ByteArrayContent(new byte[8]);
            content.Headers.ContentLength = 9_000_000;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        });
        var svc = Build(handler, maxBytes: 1024);

        Assert.Null(await svc.EnsureAsync(Target()));
        Assert.Empty(Directory.GetFiles(_dir, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task EnsureAsync_AbortsStreamingWhenBodyExceedsCapWithoutDeclaredLength()
    {
        // 不声明 Content-Length（分块/谎报）时只能靠边读边计数兜住，否则大文件会灌满磁盘
        var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new LengthlessContent(new byte[5000])
        });
        var svc = Build(handler, maxBytes: 1024);

        Assert.Null(await svc.EnsureAsync(Target()));
        Assert.Empty(Directory.GetFiles(_dir, "*.apj", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(_dir, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task EnsureAsync_EmptyBodyOrUpstreamError_ReturnsNull()
    {
        Assert.Null(await Build(BytesHandler(0)).EnsureAsync(Target()));
        Assert.Null(await Build(new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound)))
            .EnsureAsync(Target()));
    }

    [Fact]
    public async Task EnsureAsync_RejectsTraversalSegments()
    {
        var handler = BytesHandler(16);
        var svc = Build(handler);

        var escaped = Target(version: "../../../etc");
        Assert.Null(svc.ResolveSafePath(escaped));
        Assert.Null(await svc.EnsureAsync(escaped));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task List_Delete_Clear_TrackBytesAndPruneDirectories()
    {
        var svc = Build(BytesHandler(100));
        await svc.EnsureAsync(Target(asset: "arduplane.apj"));
        await svc.EnsureAsync(Target(asset: "arduplane_with_bl.hex"));

        var items = svc.List();
        Assert.Equal(2, items.Count);
        Assert.Equal(200, items.Sum(i => i.Size));
        Assert.All(items, i => Assert.Equal("Plane", i.Vehicle));

        Assert.True(svc.Delete(items[0]));
        Assert.False(svc.Delete(items[0]));   // 已删除，再删就没了
        Assert.Single(svc.List());

        var (deleted, freed) = svc.Clear();
        Assert.Equal(1, deleted);
        Assert.Equal(100, freed);
        Assert.Empty(svc.List());
        Assert.True(Directory.Exists(_dir));  // 根目录保留
    }

    [Fact]
    public void Clear_OnEmptyCache_IsNoOp()
    {
        var (deleted, freed) = Build(BytesHandler(1)).Clear();
        Assert.Equal(0, deleted);
        Assert.Equal(0, freed);
    }

    [Fact]
    public async Task List_IgnoresFilesOutsideExpectedDepth()
    {
        var svc = Build(BytesHandler(10));
        await svc.EnsureAsync(Target());
        await File.WriteAllTextAsync(Path.Combine(_dir, "stray.txt"), "x");

        Assert.Single(svc.List());
    }
}

/// <summary>不声明 Content-Length 的响应体（模拟分块传输/长度谎报），逼出边读边计数的体积上限。</summary>
internal sealed class LengthlessContent : HttpContent
{
    private readonly byte[] _data;

    public LengthlessContent(byte[] data) => _data = data;

    protected override Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context) =>
        stream.WriteAsync(_data).AsTask();

    protected override bool TryComputeLength(out long length)
    {
        length = 0;
        return false;
    }
}
