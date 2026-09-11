namespace TeamPortal.Services;

/// <summary>.history 里的一个历史版本（WriteFile 覆盖前自动备份产生）。</summary>
public record KnowledgeHistoryVersion(string FileName, long Size, long Modified);

/// <summary>
/// 知识库的版本历史：每次覆盖写入都会先把旧内容备份到
/// {BasePath}/.history/{相对目录}/{文件名}.{yyyyMMdd-HHmmss}.bak。
///
/// 这是**零成本**的文档恢复来源：文档被覆盖/清空时，旧版本仍然躺在 .history 里。
/// （注意：从未写入成功的文档不会出现在历史里，那种情况只能重新生成。）
/// </summary>
public partial class KnowledgeService
{
    /// <summary>历史版本列表，新的在前（时间戳在文件名里，字典序即时间序）。</summary>
    public IReadOnlyList<KnowledgeHistoryVersion> HistoryVersions(string relativePath)
    {
        var dir = HistoryDir(relativePath);
        if (dir is null || !Directory.Exists(dir)) return [];

        var prefix = Path.GetFileName(relativePath) + ".";
        return Directory.GetFiles(dir)
            .Where(f =>
            {
                // 手写前缀/后缀判断而不是 GetFiles 通配：文件名里的 [ ] 会被当成字符类
                var name = Path.GetFileName(f);
                return name.StartsWith(prefix, StringComparison.Ordinal)
                    && name.EndsWith(".bak", StringComparison.OrdinalIgnoreCase);
            })
            .Select(f => new FileInfo(f))
            .OrderByDescending(f => f.Name, StringComparer.Ordinal)
            .Select(f => new KnowledgeHistoryVersion(
                f.Name, f.Length, ((DateTimeOffset)f.LastWriteTimeUtc).ToUnixTimeSeconds()))
            .ToList();
    }

    /// <summary>
    /// 用历史版本恢复文件。不指定版本时取最新的一个。
    /// 目标不存在时 WriteFile 不会再产生历史条目，所以恢复本身是幂等且不污染历史的。
    /// </summary>
    /// <returns>恢复后的字节数；路径非法或没有可用历史版本时返回 null。</returns>
    public long? RestoreFromHistory(string relativePath, string? versionFileName = null)
    {
        var dir = HistoryDir(relativePath);
        if (dir is null) return null;

        var versions = HistoryVersions(relativePath);
        if (versions.Count == 0) return null;
        var picked = versionFileName is null
            ? versions[0]
            : versions.FirstOrDefault(v => v.FileName == versionFileName);
        if (picked is null) return null;

        var content = File.ReadAllText(Path.Combine(dir, picked.FileName));
        WriteFile(relativePath, content);
        _log.Info("knowledge", $"Restored from history: {relativePath} <- {picked.FileName} ({content.Length} chars)");
        return content.Length;
    }

    /// <summary>.history 下与目标文件对应的目录；路径非法返回 null（复用 ResolvePath 的越界校验）。</summary>
    private string? HistoryDir(string relativePath)
    {
        if (ResolvePath(relativePath) is null) return null;
        var normalized = relativePath.Replace('\\', '/').TrimStart('/');
        var dirPart = normalized.Contains('/') ? normalized[..normalized.LastIndexOf('/')] : "";
        var baseDir = Path.Combine(_basePath, ".history");
        return dirPart.Length == 0 ? baseDir : Path.Combine(baseDir, dirPart.Replace('/', Path.DirectorySeparatorChar));
    }
}
