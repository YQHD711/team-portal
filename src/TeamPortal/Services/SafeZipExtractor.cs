using System.IO.Compression;

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
