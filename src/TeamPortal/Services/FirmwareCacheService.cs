namespace TeamPortal.Services;

public record CachedFirmware(string Source, string Vehicle, string Version, string Board, string FileName, long Size, long Modified);

/// <summary>
/// 固件落盘缓存：磁盘布局 {CacheDir}/{source}/{vehicle|_}/{version}/{board}/{asset}。
/// 首次请求边下边存，之后同队成员直接读本地；写入用唯一 .part 再原子改名，并发下载不会互相截断。
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

    /// <summary>单次固件下载的总超时（默认 5 分钟），防止上游半死不活把请求永久挂住。</summary>
    public TimeSpan DownloadTimeout { get; }

    /// <summary>单文件体积上限：ArduPilot HEX/ELF 约 5MB，PX4 约 2MB，64MB 留足余量同时挡住超大文件打爆磁盘。</summary>
    public long MaxBytes { get; }

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

    /// <summary>返回本地可读路径（命中缓存或下载成功）；失败返回 null，绝不返回半截文件。</summary>
    public async Task<string?> EnsureAsync(FirmwareTarget target, CancellationToken ct = default)
    {
        var path = ResolveSafePath(target);
        if (path is null) return null;
        if (File.Exists(path) && new FileInfo(path).Length > 0) return path;

        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);
        var temp = Path.Combine(dir, $"{target.Asset.Name}.{Guid.NewGuid():N}.part");

        // 自带上限超时：HttpClient 的响应体流读取不受弹性管道总超时覆盖（AI 流式同理），
        // 上游挂住时必须有兜底，否则请求会一直挂着。
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(DownloadTimeout);

        try
        {
            using var res = await _http.GetAsync(target.Url, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                _log.Warn("firmware", $"Download {target.Url} returned {(int)res.StatusCode}");
                return null;
            }
            var declared = res.Content.Headers.ContentLength;
            if (declared > 0 && declared > MaxBytes)
            {
                _log.Warn("firmware", $"Refusing {target.Asset.Name}: {declared} bytes exceeds cap {MaxBytes}");
                return null;
            }

            await using (var src = await res.Content.ReadAsStreamAsync(cts.Token))
            await using (var dst = File.Create(temp))
            {
                if (!await CopyCappedAsync(src, dst, MaxBytes, cts.Token)) return null;
            }

            if (new FileInfo(temp).Length == 0) return null;
            File.Move(temp, path, overwrite: true);
            _log.Info("firmware", $"Cached firmware {target.FileName} ({new FileInfo(path).Length} bytes)");
            return path;
        }
        catch (Exception ex)
        {
            _log.Warn("firmware", $"Download failed for {target.Url}: {ex.Message}");
            return null;
        }
        finally
        {
            if (File.Exists(temp)) { try { File.Delete(temp); } catch { /* 尽力清理 */ } }
        }
    }

    /// <summary>受限拷贝；超限即停并返回 false（让 finally 删掉 .part）。</summary>
    private static async Task<bool> CopyCappedAsync(Stream src, Stream dst, long maxBytes, CancellationToken ct)
    {
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await src.ReadAsync(buffer, ct)) > 0)
        {
            total += read;
            if (total > maxBytes) return false;
            await dst.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        return true;
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

    /// <summary>删文件后回收空目录，避免缓存面板出现一堆空壳。</summary>
    private void PruneEmptyDirs(string? dir)
    {
        var root = Path.GetFullPath(Root);
        while (!string.IsNullOrEmpty(dir) && dir.Length > root.Length && Directory.Exists(dir))
        {
            if (Directory.EnumerateFileSystemEntries(dir).Any()) return;
            Directory.Delete(dir);
            dir = Path.GetDirectoryName(dir);
        }
    }
}
