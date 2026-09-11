using System.Net;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 固件落盘缓存 + 边下边转：命中缓存不再回源、超限拒收、中断不留半截文件、
/// 缓存文件只在整包读完后才发布、路径段不可越界。
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

    private FirmwareCacheService Build(StubHttpHandler handler, long? maxBytes = 1_000_000)
    {
        var settings = new Dictionary<string, string?> { ["Firmware:CacheDir"] = _dir };
        if (maxBytes is not null) settings["Firmware:MaxBytes"] = maxBytes.Value.ToString();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(settings)
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

    /// <summary>把下载流读干并返回读到的字节数（模拟端点把内容写给客户端）。</summary>
    private static async Task<long> DrainAsync(Stream stream)
    {
        var buffer = new byte[8192];
        long total = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer)) > 0) total += read;
        return total;
    }

    private string[] CachedFiles() =>
        Directory.Exists(_dir) ? Directory.GetFiles(_dir, "*", SearchOption.AllDirectories) : [];

    [Fact]
    public async Task OpenAsync_Miss_StreamsThroughAndPublishesCacheAfterCompletion()
    {
        var handler = BytesHandler(128);
        var svc = Build(handler);

        var download = await svc.OpenAsync(Target());

        Assert.NotNull(download);
        Assert.False(download!.Cached);
        Assert.Equal(128, download.Length);
        // 关键：读完之前缓存里不该有任何东西（半截文件绝不发布）
        Assert.Empty(CachedFiles());

        Assert.Equal(128, await DrainAsync(download.Stream));
        await download.Stream.DisposeAsync();

        var cached = Assert.Single(CachedFiles());
        Assert.Equal(Path.Combine(_dir, "ardupilot", "Plane", "stable", "Pixhawk6X", "arduplane.apj"), cached);
        Assert.Equal(128, new FileInfo(cached).Length);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task OpenAsync_Hit_ServesFromDiskWithoutTouchingUpstream()
    {
        var handler = BytesHandler(64);
        var svc = Build(handler);
        var first = await svc.OpenAsync(Target());
        await DrainAsync(first!.Stream);
        await first.Stream.DisposeAsync();

        var second = await svc.OpenAsync(Target());

        Assert.NotNull(second);
        Assert.True(second!.Cached);
        Assert.Equal(64, second.Length);
        Assert.Equal(64, await DrainAsync(second.Stream));
        await second.Stream.DisposeAsync();
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task OpenAsync_InterruptedMidStream_PublishesNothing()
    {
        var handler = BytesHandler(256);
        var svc = Build(handler);
        var download = await svc.OpenAsync(Target());

        // 只读一部分就断开（客户端取消）
        var partial = new byte[32];
        await download!.Stream.ReadAsync(partial);
        await download.Stream.DisposeAsync();

        Assert.Empty(CachedFiles());
        Assert.Empty(Directory.GetFiles(_dir, "*.part", SearchOption.AllDirectories));
        // 没发布缓存 → 下次仍是回源
        Assert.False(svc.TryGetCached(Target(), out _, out _));
    }

    [Fact]
    public async Task OpenAsync_BodyOverCapWithoutDeclaredLength_AbortsAndPublishesNothing()
    {
        var handler = new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new LengthlessContent(new byte[5000])
        });
        var svc = Build(handler, maxBytes: 1024);

        var download = await svc.OpenAsync(Target());

        await Assert.ThrowsAsync<IOException>(() => DrainAsync(download!.Stream));
        await download.Stream.DisposeAsync();
        Assert.Empty(CachedFiles());
        Assert.Empty(Directory.GetFiles(_dir, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task OpenAsync_DeclaredOversize_IsRejectedBeforeReadingBody()
    {
        var handler = new StubHttpHandler(_ =>
        {
            var content = new ByteArrayContent(new byte[8]);
            content.Headers.ContentLength = 9_000_000;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        });
        var svc = Build(handler, maxBytes: 1024);

        Assert.Null(await svc.OpenAsync(Target()));
        Assert.Empty(CachedFiles());
    }

    [Fact]
    public async Task OpenAsync_EmptyBodyOrUpstreamErrorOrTraversal_ReturnsNull()
    {
        // 空响应体不是合法固件
        Assert.Null(await Build(BytesHandler(0)).OpenAsync(Target()));
        Assert.Null(await Build(new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound)))
            .OpenAsync(Target()));

        var handler = BytesHandler(16);
        var svc = Build(handler);
        Assert.Null(svc.ResolveSafePath(Target(version: "../../../etc")));
        Assert.Null(await svc.OpenAsync(Target(version: "../../../etc")));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task OpenAsync_DownloadCarriesUserAgent()
    {
        // GitHub 资产地址同样要求 User-Agent，否则 403
        var handler = BytesHandler(32);
        var download = await Build(handler).OpenAsync(Target());
        await DrainAsync(download!.Stream);
        await download.Stream.DisposeAsync();

        Assert.All(handler.UserAgents, ua => Assert.Contains("TeamPortal-Firmware", ua));
    }

    [Fact]
    public void DownloadBudget_DefaultsToFiveMinutes()
    {
        // 不传 MaxBytes → 走默认 64MB 上限与 5 分钟下载预算
        var svc = Build(BytesHandler(1), maxBytes: null);

        Assert.Equal(TimeSpan.FromMinutes(5), svc.DownloadTimeout);
        Assert.Equal(64L * 1024 * 1024, svc.MaxBytes);
    }

    [Fact]
    public async Task List_Delete_Clear_TrackBytesAndKeepCacheRoot()
    {
        var svc = Build(BytesHandler(100));
        foreach (var asset in new[] { "arduplane.apj", "arduplane_with_bl.hex" })
        {
            var dl = await svc.OpenAsync(Target(asset: asset));
            await DrainAsync(dl!.Stream);
            await dl.Stream.DisposeAsync();
        }

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
        // 缓存根目录必须留着自己（否则下一次写入的父目录不存在，且可能一路删到上层）
        Assert.True(Directory.Exists(_dir));
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
        var dl = await svc.OpenAsync(Target());
        await DrainAsync(dl!.Stream);
        await dl.Stream.DisposeAsync();
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
