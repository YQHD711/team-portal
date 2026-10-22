using System.IO.Compression;
using System.Text;

namespace TeamPortal.Services;

/// <summary>
/// **受限 ZIP 解压**。审计 #12：原先直接 `ZipFile.ExtractToDirectory`，既没有条目数/总量上限，
/// 也没有 zip-slip 路径校验 —— 一个几百 KB 的压缩炸弹就能把容器磁盘写满；
/// 条目名里的 `../` 还能把文件写到工作区之外。
///
/// 这里逐条目解压，先校验再落盘：
///  - 目标路径必须落在解压根之内（zip slip）
///  - 条目数、单文件大小、累计解压总量都有上限
///  - 只解普通文件/目录，跳过指向目录外的符号链接式条目
/// </summary>
public static class SafeZipExtractor
{
    public const int MaxEntries = 50_000;
    public const long MaxEntryBytes = 100L * 1024 * 1024;        // 单文件 100MB
    public const long MaxTotalBytes = 500L * 1024 * 1024;        // 解压总量 500MB

    // ── 临时源码包（审计 M-11）────────────────────────────────────────────
    /// <summary>`SourceUrl` 里 ZIP 路径的编码前缀（`archive::<base64>`）。</summary>
    public const string ArchiveUrlPrefix = "archive::";

    /// <summary>上传的源码 ZIP 落盘目录：`{tmp}/teamportal-zip`。</summary>
    public static string TempZipDir => Path.Combine(Path.GetTempPath(), "teamportal-zip");

    /// <summary>
    /// 临时 ZIP 保留期：**不能在上传后立刻删** —— `retry-missing` / `reclone` 会拿 `SourceUrl`
    /// 里的路径重新解压。因此改为「超过保留期由维护任务清理 + 任务删除时立刻删」。
    /// </summary>
    public static readonly TimeSpan DefaultArchiveRetention = TimeSpan.FromDays(7);

    /// <summary>从 `archive::<base64>` 解出 ZIP 的绝对路径；格式不对返回 null（不抛）。</summary>
    public static string? TryDecodeArchiveSource(string? sourceUrl)
    {
        if (string.IsNullOrEmpty(sourceUrl) || !sourceUrl.StartsWith(ArchiveUrlPrefix, StringComparison.Ordinal))
            return null;
        try
        {
            var path = Encoding.UTF8.GetString(Convert.FromBase64String(sourceUrl[ArchiveUrlPrefix.Length..]));
            return string.IsNullOrWhiteSpace(path) ? null : Path.GetFullPath(path);
        }
        catch (Exception) { return null; }
    }

    /// <summary>
    /// 清理超过保留期的临时 ZIP（默认 7 天）。返回删除数量。
    /// 刚上传/正在解压的文件 mtime 是当前时间，不会被误删；已超过保留期且仍需要重新克隆的任务会得到
    /// "源码包不存在，请重新上传"的可读错误 —— 这是保留期换磁盘空间的明确取舍。
    /// </summary>
    public static int CleanupOldArchives(TimeSpan? retention = null, string? directory = null)
    {
        var dir = directory ?? TempZipDir;
        if (!Directory.Exists(dir)) return 0;

        var cutoff = DateTime.UtcNow - (retention ?? DefaultArchiveRetention);
        var removed = 0;
        foreach (var file in Directory.EnumerateFiles(dir, "*.zip", SearchOption.TopDirectoryOnly))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(file) >= cutoff) continue;
                File.Delete(file);
                removed++;
            }
            catch (Exception)
            {
                // 正在被解压 / 无权限：留到下一轮，绝不能因为一个文件让整轮清理失败
            }
        }
        return removed;
    }

    /// <summary>
    /// 任务删除时立刻删掉它的源码 ZIP（M-11）。只接受落在 `TempZipDir` 内的路径，
    /// 防止有人把 `SourceUrl` 改成任意路径后借删除接口删服务器文件。返回是否真的删了。
    /// </summary>
    public static bool TryDeleteArchiveFromSource(string? sourceUrl)
    {
        var path = TryDecodeArchiveSource(sourceUrl);
        if (path is null) return false;

        string archiveRoot;
        try { archiveRoot = Path.GetFullPath(TempZipDir) + Path.DirectorySeparatorChar; }
        catch (Exception) { return false; }
        if (!path.StartsWith(archiveRoot, StringComparison.OrdinalIgnoreCase)) return false;

        try
        {
            if (!File.Exists(path)) return false;
            File.Delete(path);
            return true;
        }
        catch (Exception) { return false; }
    }

    public static void Extract(string zipPath, string destDir,
        int maxEntries = MaxEntries, long maxEntryBytes = MaxEntryBytes, long maxTotalBytes = MaxTotalBytes)
    {
        Directory.CreateDirectory(destDir);
        var root = Path.GetFullPath(destDir);
        var rootWithSep = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;

        using var archive = ZipFile.OpenRead(zipPath);
        if (archive.Entries.Count > maxEntries)
            throw new InvalidOperationException($"压缩包条目过多（{archive.Entries.Count} > {maxEntries}），已拒绝解压");

        long total = 0;
        foreach (var entry in archive.Entries)
        {
            // 目录条目（以 / 结尾、Length=0）只建目录
            var target = Path.GetFullPath(Path.Combine(root, entry.FullName));
            if (!target.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"压缩包内包含越界路径，已拒绝解压: {entry.FullName}");

            if (string.IsNullOrEmpty(entry.Name))   // 目录
            {
                Directory.CreateDirectory(target);
                continue;
            }
            if (entry.Length > maxEntryBytes)
                throw new InvalidOperationException($"压缩包内单个文件过大（{entry.Length} 字节），已拒绝解压: {entry.FullName}");
            total += entry.Length;
            if (total > maxTotalBytes)
                throw new InvalidOperationException($"压缩包解压总量超过上限（{maxTotalBytes} 字节），已拒绝解压");

            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, overwrite: true);
        }
    }
}
