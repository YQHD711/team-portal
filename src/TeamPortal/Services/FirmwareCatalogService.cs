using Microsoft.Extensions.Caching.Memory;

namespace TeamPortal.Services;

/// <summary>
/// 固件目录服务：向 ArduPilot 目录站 / PX4 GitHub Releases 取目录，内存 TTL 缓存后供前端级联选择。
/// 关键安全约定：客户端只传 source/vehicle/version/board/asset 这些路径段，下载 URL 一律由目录数据推导；
/// <see cref="ResolveAsync"/> 会回查目录确认目标真实存在，因此 ../../ 之类的段永远拼不出可达 URL。
/// </summary>
public partial class FirmwareCatalogService
{
    private readonly HttpClient _http;
    private readonly IMemoryCache _cache;
    private readonly LogService _log;
    private readonly string _arduPilotBase;
    private readonly string _px4Api;

    public FirmwareCatalogService(HttpClient http, IMemoryCache cache, IConfiguration config, LogService log)
    {
        _http = http;
        _cache = cache;
        _log = log;
        _arduPilotBase = (config["Firmware:ArduPilotBase"] ?? "https://firmware.ardupilot.org").TrimEnd('/');
        _px4Api = config["Firmware:Px4ReleasesApi"] ?? "https://api.github.com/repos/PX4/PX4-Autopilot/releases";
        var minutes = int.TryParse(config["Firmware:CatalogTtlMinutes"], out var m) && m > 0 ? m : 30;
        Ttl = TimeSpan.FromMinutes(minutes);
    }

    private TimeSpan Ttl { get; }

    public static bool IsKnownVehicle(string? vehicle) =>
        vehicle is not null && FirmwareSource.ArduPilotVehicles.Any(v => v.Key == vehicle);

    // 目录不可达时一律返回 null（端点转 503），绝不返回空列表 —— 空列表会被前端误读成"这个机型没有固件"
    public Task<IReadOnlyList<FirmwareVersion>?> GetVersionsAsync(string source, string? vehicle) =>
        source == FirmwareSource.Px4 ? Px4VersionsAsync() : ArduPilotVersionsAsync(vehicle);

    public Task<IReadOnlyList<FirmwareBoard>?> GetBoardsAsync(string source, string? vehicle, string version) =>
        source == FirmwareSource.Px4 ? Px4BoardsAsync(version) : ArduPilotBoardsAsync(vehicle, version);

    public Task<IReadOnlyList<FirmwareAsset>?> GetAssetsAsync(string source, string? vehicle, string version, string board) =>
        source == FirmwareSource.Px4 ? Px4AssetsAsync(version, board) : ArduPilotAssetsAsync(vehicle, version, board);

    /// <summary>把客户端选择解析成真实下载目标；任一段不在目录中即返回 null（404），不做任何兜底拼接。</summary>
    public async Task<FirmwareTarget?> ResolveAsync(string source, string? vehicle, string version, string board, string assetName)
    {
        if (!FirmwareSource.IsKnown(source)) return null;
        if (!FirmwareSegments.IsSafe(version) || !FirmwareSegments.IsSafe(board) || !FirmwareSegments.IsSafe(assetName))
            return null;

        if (source == FirmwareSource.ArduPilot)
        {
            if (!IsKnownVehicle(vehicle)) return null;
            var assets = await ArduPilotAssetsAsync(vehicle, version, board);
            var asset = assets?.FirstOrDefault(a => a.Name == assetName);
            if (asset is null) return null;
            var url = $"{_arduPilotBase}/{vehicle}/{version}/{board}/{asset.Name}";
            return new FirmwareTarget(source, vehicle, version, board, asset, url, asset.Name);
        }

        var px4Assets = await Px4ReleaseAsync(version);
        var px4Asset = px4Assets?.Assets.FirstOrDefault(a => a.Name == assetName);
        if (px4Assets is null || px4Asset is null) return null;
        if (!IsTrustedPx4Url(px4Asset.Url)) return null;
        return new FirmwareTarget(
            source, null, version, board,
            new FirmwareAsset(px4Asset.Name, "px4", "PX4 固件（QGroundControl 刷写）", px4Asset.Size),
            px4Asset.Url, px4Asset.Name);
    }

    /// <summary>只信任 GitHub 自家域名（browser_download_url 指向 github.com，重定向由 HttpClient 处理）。</summary>
    private static bool IsTrustedPx4Url(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps) return false;
        return uri.Host is "github.com" or "objects.githubusercontent.com" or "codeload.github.com";
    }

    /// <summary>带 TTL 的内存缓存；factory 返回 null（上游失败）时不写缓存，避免一次抖动把空结果固化 30 分钟。</summary>
    private async Task<T?> CachedAsync<T>(string key, Func<Task<T?>> factory) where T : class
    {
        if (_cache.TryGetValue(key, out T? hit) && hit is not null) return hit;
        var value = await factory();
        if (value is not null) _cache.Set(key, value, Ttl);
        return value;
    }

    /// <summary>抓取文本；失败返回 null（调用方返回 503 而不是抛 500）。上游不可达是可预期状态。</summary>
    private async Task<string?> FetchTextAsync(string url)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.UserAgent.ParseAdd(FirmwareUpstream.UserAgent);
            req.Headers.Accept.ParseAdd(FirmwareUpstream.GitHubAccept);
            using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseContentRead);
            if (!res.IsSuccessStatusCode)
            {
                _log.Warn("firmware", $"Upstream {url} returned {(int)res.StatusCode}");
                return null;
            }
            return await res.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            _log.Warn("firmware", $"Upstream fetch failed for {url}: {ex.Message}");
            return null;
        }
    }

    private async Task<IReadOnlyList<FirmwareListingEntry>?> FetchListingAsync(string url)
    {
        var html = await FetchTextAsync(url);
        return html is null ? null : FirmwareCatalogParser.ParseListing(html);
    }
}
