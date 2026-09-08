namespace TeamPortal.Services;

public class FlightLogService
{
    private readonly string _logDir;

    public FlightLogService(IConfiguration config)
    {
        // 目录可用配置覆盖(测试隔离用),生产默认相对数据目录
        _logDir = config["FlightLogs:Dir"] ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "flightlogs");
    }

    public async Task<object?> ListLogs()
    {
        Directory.CreateDirectory(_logDir);
        var logs = new List<object>();
        foreach (var f in Directory.GetFiles(_logDir, "*.tlog").Concat(Directory.GetFiles(_logDir, "*.bin")).OrderByDescending(File.GetLastWriteTime))
        {
            var info = new FileInfo(f);
            logs.Add(new { filename = info.Name, size = info.Length, modified = ((DateTimeOffset)info.LastWriteTimeUtc).ToUnixTimeSeconds() });
        }
        return new { logs };
    }

    /// <summary>解析并校验 filename 必须落在 _logDir 内（防目录穿越）。非法返回 null。</summary>
    private string? ResolveSafePath(string filename)
    {
        if (string.IsNullOrWhiteSpace(filename)) return null;
        if (filename.Contains('/') || filename.Contains('\\') || filename.StartsWith('.') || filename.Contains(".."))
            return null;
        var full = Path.GetFullPath(Path.Combine(_logDir, filename));
        var root = Path.GetFullPath(_logDir);
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
        return full;
    }

    /// <summary>读取飞行日志原始字节（真下载）。文件名非法或不存在返回 null。</summary>
    public (byte[]? Bytes, string? ContentType)? GetFile(string filename)
    {
        var full = ResolveSafePath(filename);
        if (full is null || !File.Exists(full)) return null;
        var contentType = Path.GetExtension(full).ToLowerInvariant() switch
        {
            ".tlog" => "application/octet-stream",
            ".bin" => "application/octet-stream",
            _ => "application/octet-stream"
        };
        return (File.ReadAllBytes(full), contentType);
    }

    /// <summary>删除飞行日志文件。成功返回 true；不存在或非法返回 false。</summary>
    public bool DeleteFile(string filename)
    {
        var full = ResolveSafePath(filename);
        if (full is null || !File.Exists(full)) return false;
        File.Delete(full);
        return true;
    }
}
