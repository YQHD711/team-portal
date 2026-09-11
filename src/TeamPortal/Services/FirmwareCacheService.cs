namespace TeamPortal.Services;

public record CachedFirmware(string Source, string Vehicle, string Version, string Board, string FileName, long Size, long Modified);

/// <summary>一次下载的载荷。Cached=true 时 Stream 是本地文件流；false 时是边下边转的缓存流。</summary>
public record FirmwareDownload(Stream Stream, long? Length, bool Cached, string FileName);

/// <summary>
/// 固件落盘缓存：磁盘布局 {CacheDir}/{source}/{vehicle|_}/{version}/{board}/{asset}。
/// 命中缓存直接读本地；未命中则由 <see cref="FirmwareCachingStream"/> 边下边转，
/// 客户端从第一个字节就能看到真实进度，而不是干等服务器把整包拉完。
/// </summary>
public class FirmwareCacheService
{
    private readonly HttpClient _http;
    private readonly LogService _log;

    public FirmwareCacheService(HttpClient http, IConfiguration config, LogService log)
    {
        _http = http;
        _log = log;
        Root = Path.GetFullPath(config["Firmware:CacheDir"]
            ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "firmware"));
        MaxBytes = long.TryParse(config["Firmware:MaxBytes"], out var m) && m > 0 ? m : 64L * 1024 * 1024;
        var timeoutSeconds = int.TryParse(config["Firmware:DownloadTimeoutSeconds"], out var t) && t > 0 ? t : 300;
        DownloadTimeout = TimeSpan.FromSeconds(timeoutSeconds);
    }

    public string Root { get; }

    /// <summary>单文件体积上限：ArduPilot HEX/ELF 约 5MB，PX4 约 2MB，64MB 留足余量同时挡住超大文件打爆磁盘。</summary>
    public long MaxBytes { get; }

    /// <summary>单次固件下载的总超时（默认 5 分钟），防止上游半死不活把请求永久挂住。</summary>
    public TimeSpan DownloadTimeout { get; }

    /// <summary>缓存文件的绝对路径；任一段非法或越出 Root 返回 null。</summary>
    public string? ResolveSafePath(FirmwareTarget target)
    {
        var segments = new[]
        {
            target.Source,
            target.Vehicle ?? "_",
            target.Version,
            target.Board,
            target.Asset.Name
        };
        if (segments.Any(s => !FirmwareSegments.IsSafe(s))) return null;

        var full = Path.GetFullPath(Path.Combine([Root, .. segments]));
        var root = Path.GetFullPath(Root);
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
        return full;
    }

    /// <summary>命中本地缓存则返回路径与字节数（半截文件视为未命中）。</summary>
    public bool TryGetCached(FirmwareTarget target, out string path, out long bytes)
    {
        path = string.Empty;
        bytes = 0;
        var full = ResolveSafePath(target);
        if (full is null || !File.Exists(full)) return false;
        var length = new FileInfo(full).Length;
        if (length <= 0) return false;
        path = full;
        bytes = length;
        return true;
    }

    /// <summary>
    /// 打开下载流：命中缓存返回文件流，否则回源并返回「边下边转」的流。
    /// 失败（非法路径 / 上游 4xx5xx / 超时 / 磁盘不可写）一律返回 null，由端点转 502。
    /// </summary>
    public async Task<FirmwareDownload?> OpenAsync(FirmwareTarget target, CancellationToken ct = default)
    {
        if (TryGetCached(target, out var cachedPath, out var cachedBytes))
            return new FirmwareDownload(File.OpenRead(cachedPath), cachedBytes, true, target.FileName);

        var path = ResolveSafePath(target);
        if (path is null) return null;
        var temp = Path.Combine(Path.GetDirectoryName(path)!, $"{target.Asset.Name}.{Guid.NewGuid():N}.part");

        // 自带上限超时：上游挂住时必须有兜底，否则请求会一直挂着。
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(DownloadTimeout);

        HttpResponseMessage? res = null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);

            using var req = new HttpRequestMessage(HttpMethod.Get, target.Url);
            req.Headers.UserAgent.ParseAdd(FirmwareUpstream.UserAgent);
            res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                _log.Warn("firmware", $"Upstream {target.Url} returned {(int)res.StatusCode}");
                return null;
            }
            var declared = res.Content.Headers.ContentLength;
            if (declared > MaxBytes)
            {
                _log.Warn("firmware", $"Refusing {target.Asset.Name}: {declared} bytes exceeds cap {MaxBytes}");
                return null;
            }
            // 空响应体不是合法固件：宁可报错，也别让成员存下一个 0 字节的"固件"
            if (declared is 0)
            {
                _log.Warn("firmware", $"Upstream returned an empty body for {target.Url}");
                return null;
            }

            var upstream = await res.Content.ReadAsStreamAsync(cts.Token);
            // res 的所有权交给这个流（响应体流必须活到客户端读完）
            var stream = new FirmwareCachingStream(upstream, res, temp, path, MaxBytes, _log);
            res = null;
            return new FirmwareDownload(stream, declared, false, target.FileName);
        }
        catch (Exception ex)
        {
            _log.Warn("firmware", $"Upstream fetch failed for {target.Url}: {ex.Message}");
            return null;
        }
        finally
        {
            res?.Dispose();
        }
    }

    public IReadOnlyList<CachedFirmware> List()
    {
        if (!Directory.Exists(Root)) return [];
        var items = new List<CachedFirmware>();
        foreach (var file in Directory.EnumerateFiles(Root, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(Root, file).Split(Path.DirectorySeparatorChar);
            if (rel.Length != 5) continue;
            var info = new FileInfo(file);
            items.Add(new CachedFirmware(
                rel[0], rel[1], rel[2], rel[3], rel[4], info.Length,
                ((DateTimeOffset)info.LastWriteTimeUtc).ToUnixTimeSeconds()));
        }
        return items.OrderByDescending(i => i.Modified).ToList();
    }

    public bool Delete(CachedFirmware item)
    {
        var rel = Path.Combine(item.Source, item.Vehicle, item.Version, item.Board, item.FileName);
        var full = Path.GetFullPath(Path.Combine(Root, rel));
        if (!full.StartsWith(Path.GetFullPath(Root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return false;
        if (!File.Exists(full)) return false;
        File.Delete(full);
        PruneEmptyDirs(Path.GetDirectoryName(full));
        return true;
    }

    public (int Deleted, long FreedBytes) Clear()
    {
        var items = List();
        long freed = 0;
        var deleted = 0;
        foreach (var item in items)
            if (Delete(item)) { freed += item.Size; deleted++; }
        return (deleted, freed);
    }

    /// <summary>删文件后回收空目录，避免缓存面板出现一堆空壳。只清 Root 之内，绝不动 Root 本身及其上层。</summary>
    private void PruneEmptyDirs(string? dir)
    {
        var root = Path.GetFullPath(Root);
        while (!string.IsNullOrEmpty(dir) && dir.Length > root.Length && Directory.Exists(dir))
        {
            if (Directory.EnumerateFileSystemEntries(dir).Any()) return;
            try { Directory.Delete(dir); } catch { return; }
            dir = Path.GetDirectoryName(dir);
        }
    }
}
