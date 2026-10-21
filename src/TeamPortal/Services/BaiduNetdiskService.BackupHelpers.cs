using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 云备份（H-06）的纯逻辑助手：数据库路径解析、SQLite 在线快照、settings.json 脱敏。
/// 与 BaiduNetdiskService.Backup.cs 同属 partial 类；独立文件是为了让 Backup 主流程保持在 200 行以内，
/// 并让这些助手可以被单测直接调用（不需要网盘鉴权）。
/// </summary>
public partial class BaiduNetdiskService
{
    /// <summary>设置键名归一化后按这些后缀/片段判定为凭据。</summary>
    private static readonly string[] SensitiveSettingSuffixes = ["password", "secret", "token", "key"];
    private static readonly string[] SensitiveSettingFragments = ["connectionstring", "apikey", "accesskey"];

    /// <summary>键名归一化后判是否凭据类设置（password/secret/token/key 结尾，apiKey/accessKey/connectionString 片段）。</summary>
    internal static bool IsSensitiveSettingKey(string key)
    {
        var normalized = new string(key.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        return normalized.Length > 0
            && (SensitiveSettingSuffixes.Any(normalized.EndsWith) || SensitiveSettingFragments.Any(normalized.Contains));
    }

    internal static string ParseDataSource(string connectionString)
    {
        foreach (var part in connectionString.Split(';', StringSplitOptions.TrimEntries))
            if (part.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase))
                return part["Data Source=".Length..];
        return string.Empty;
    }

    /// <summary>把连接串里的 Data Source 解析成绝对路径（相对路径以 baseDir 为基准）。</summary>
    internal static string ResolveDatabasePath(IConfiguration config, string baseDir)
    {
        var connectionString = config.GetConnectionString("DefaultConnection") ?? "Data Source=../../data/teamportal.db";
        var dataSource = ParseDataSource(connectionString);
        if (string.IsNullOrWhiteSpace(dataSource)) dataSource = "../../data/teamportal.db";
        return Path.IsPathFullyQualified(dataSource)
            ? Path.GetFullPath(dataSource)
            : Path.GetFullPath(Path.Combine(baseDir, dataSource));
    }

    /// <summary>SQLite 在线备份 API：一致性快照，含源库 WAL 中已提交的事务（File.Copy 会漏）。</summary>
    internal static void SnapshotDatabase(string sourcePath, string destPath)
    {
        using var source = new SqliteConnection($"Data Source={sourcePath}");
        // 目标连接必须关闭连接池：Microsoft.Data.Sqlite 默认池化，Dispose 后底层句柄仍被池持有，
        // 随后 ZipArchive.CreateEntryFromFile 会报 "file is being used by another process"（实测）。
        using var dest = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = destPath,
            Pooling = false,
        }.ToString());
        source.Open();
        dest.Open();
        source.BackupDatabase(dest);
    }

    /// <summary>settings.json 内容：保持 SystemSetting 字段结构，凭据值替换为 ***（键名保留）。</summary>
    internal static string SerializeSettingsRedacted(Dictionary<string, List<SystemSetting>> grouped)
    {
        var redacted = grouped.ToDictionary(
            group => group.Key,
            group => group.Value.Select(s => new
            {
                s.Key,
                Value = IsSensitiveSettingKey(s.Key) ? "***" : s.Value,
                s.Category,
                s.Description,
                s.UpdatedAt,
            }).ToList());
        return JsonSerializer.Serialize(redacted, new JsonSerializerOptions
        {
            WriteIndented = true,
            // 中文设置值保持可读（默认 encoder 会把中文转成 \uXXXX，恢复时不便人工核对）
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        });
    }

    /// <summary>数据根目录：容器里 cwd=/app → /data；本地开发为仓库 data/。</summary>
    private static string ResolveDataRoot(string baseDir) => Path.GetFullPath(Path.Combine(baseDir, "..", "..", "data"));
}