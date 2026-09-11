using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 固件目录纯解析：ArduPilot 的 Apache 目录列表 HTML 与 PX4 的 GitHub Releases JSON。
/// 全部是静态纯函数（不碰网络、不碰磁盘），便于用真实样例做单元测试。
/// </summary>
public static partial class FirmwareCatalogParser
{
    private static readonly Regex RowSplitRegex = RowSplitPattern();
    private static readonly Regex HrefRegex = HrefPattern();
    private static readonly Regex SizeRegex = SizePattern();

    /// <summary>按 &lt;tr 切块而不是配对 &lt;tr&gt;…&lt;/tr&gt;：ArduPilot 的「Parent Directory」行没有闭合标签，
    /// 配对写法会把它和下一行并成一块，导致紧随其后的第一个目录/文件被吞掉（飞控板列表会丢第一个板子）。</summary>
    [GeneratedRegex(@"<tr\b", RegexOptions.IgnoreCase)]
    private static partial Regex RowSplitPattern();

    [GeneratedRegex(@"href=""([^""]+)""", RegexOptions.IgnoreCase)]
    private static partial Regex HrefPattern();

    /// <summary>体积单元格：只有文件行才有裸数字（目录行是 --），够精确不会误伤带属性的 td。</summary>
    [GeneratedRegex(@"<td>(\d+)</td>", RegexOptions.IgnoreCase)]
    private static partial Regex SizePattern();

    /// <summary>解析 Apache 目录列表，只保留指向子目录 / 文件的链接（父目录链接被剔除）。</summary>
    public static IReadOnlyList<FirmwareListingEntry> ParseListing(string html)
    {
        var result = new List<FirmwareListingEntry>();
        if (string.IsNullOrEmpty(html)) return result;

        var chunks = RowSplitRegex.Split(html);
        for (var i = 1; i < chunks.Length; i++)
        {
            var body = chunks[i];
            // 只认真正的目录行/文件行（图标单元格），表头与页脚脚本自然被排除
            var isDir = body.Contains("folder.gif", StringComparison.OrdinalIgnoreCase);
            if (!isDir && !body.Contains("text.gif", StringComparison.OrdinalIgnoreCase)) continue;
            if (body.Contains("back.gif", StringComparison.OrdinalIgnoreCase)) continue;

            var hrefMatch = HrefRegex.Match(body);
            if (!hrefMatch.Success) continue;

            var href = hrefMatch.Groups[1].Value;
            if (href.Length == 0 || href.StartsWith('#')) continue;

            var trimmed = href.TrimEnd('/');
            var name = trimmed[(trimmed.LastIndexOf('/') + 1)..];
            if (name.Length == 0 || name == "..") continue;

            long? size = null;
            var sizeMatch = SizeRegex.Match(body);
            if (!isDir && sizeMatch.Success && long.TryParse(sizeMatch.Groups[1].Value, out var parsed))
                size = parsed;

            result.Add(new FirmwareListingEntry(Uri.UnescapeDataString(name), href, isDir, size));
        }
        return result;
    }

    /// <summary>ArduPilot 版本目录：stable / beta / latest 三个通道 + stable-X.Y.Z 历史版本（按版本号降序）。</summary>
    public static IReadOnlyList<FirmwareVersion> ParseArduPilotVersions(IEnumerable<FirmwareListingEntry> entries)
    {
        var versions = new List<FirmwareVersion>();
        foreach (var e in entries)
        {
            if (!e.IsDirectory) continue;
            if (e.Name is "stable" or "beta" or "latest")
                versions.Add(new FirmwareVersion(e.Name, e.Name switch
                {
                    "stable" => "稳定版 stable",
                    "beta" => "测试版 beta",
                    _ => "最新构建 latest"
                }, e.Name is "beta" or "latest"));
            else if (e.Name.StartsWith("stable-", StringComparison.Ordinal) && IsNumericVersion(e.Name[7..]))
                versions.Add(new FirmwareVersion(e.Name, e.Name[7..], false));
        }

        return versions
            .OrderBy(v => ChannelRank(v.Id))
            .ThenByDescending(v => VersionParts(v.Id))
            .ToList();
    }

    /// <summary>ArduPilot 固件文件：只保留可刷写的镜像，过滤 features.txt / git-version.txt 等元数据。</summary>
    public static IReadOnlyList<FirmwareAsset> ParseArduPilotAssets(IEnumerable<FirmwareListingEntry> entries)
    {
        var assets = new List<FirmwareAsset>();
        foreach (var e in entries)
        {
            if (e.IsDirectory) continue;
            var (kind, label) = ClassifyArduPilot(e.Name);
            if (kind is null) continue;
            assets.Add(new FirmwareAsset(e.Name, kind, label, e.Size));
        }
        return assets.OrderBy(a => KindRank(a.Kind)).ThenBy(a => a.Name, StringComparer.Ordinal).ToList();
    }

    private static (string? Kind, string Label) ClassifyArduPilot(string name)
    {
        var lower = name.ToLowerInvariant();
        if (lower.EndsWith(".apj")) return ("apj", "APJ（Mission Planner / QGC 刷写，推荐）");
        if (lower.EndsWith(".abin")) return ("abin", "ABIN（Bootloader 无线刷写）");
        if (lower.EndsWith(".hex")) return ("hex", "HEX（含 Bootloader，DFU / 烧录器）");
        if (lower.EndsWith(".elf")) return ("elf", "ELF（调试 / 反汇编，不能直接刷写）");
        return (null, "");
    }

    private static int KindRank(string kind) => kind switch
    {
        "apj" => 0, "abin" => 1, "hex" => 2, "elf" => 3, _ => 9
    };

    private static int ChannelRank(string id) => id switch
    {
        "stable" => 0, "beta" => 1, "latest" => 2, _ => 3
    };

    private static bool IsNumericVersion(string s) =>
        s.Length > 0 && s.All(c => char.IsAsciiDigit(c) || c == '.');

    private static Version VersionParts(string id)
    {
        var raw = id.StartsWith("stable-", StringComparison.Ordinal) ? id[7..] : "0";
        var parts = raw.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        return new Version(
            parts.Length > 0 ? parts[0] : 0,
            parts.Length > 1 ? parts[1] : 0,
            parts.Length > 2 ? parts[2] : 0,
            parts.Length > 3 ? parts[3] : 0);
    }

    /// <summary>PX4 固件是 GitHub Release 资产，一次响应即含版本 + 资产，故解析成一个整体结构。</summary>
    public static IReadOnlyList<Px4Release> ParsePx4Releases(string json)
    {
        var releases = new List<Px4Release>();
        if (string.IsNullOrWhiteSpace(json)) return releases;

        JsonDocument doc;
        try { doc = JsonDocument.Parse(json); }
        catch (JsonException) { return releases; }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return releases;
            foreach (var rel in doc.RootElement.EnumerateArray())
            {
                var tag = rel.TryGetProperty("tag_name", out var t) ? t.GetString() : null;
                if (string.IsNullOrWhiteSpace(tag)) continue;

                var label = rel.TryGetProperty("name", out var n) ? n.GetString() : null;
                var prerelease = rel.TryGetProperty("prerelease", out var p) && p.ValueKind == JsonValueKind.True;

                var assets = new List<Px4Asset>();
                if (rel.TryGetProperty("assets", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var a in arr.EnumerateArray())
                    {
                        var name = a.TryGetProperty("name", out var an) ? an.GetString() : null;
                        var url = a.TryGetProperty("browser_download_url", out var au) ? au.GetString() : null;
                        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(url)) continue;
                        if (!name.EndsWith(".px4", StringComparison.OrdinalIgnoreCase)) continue;
                        var size = a.TryGetProperty("size", out var sz) && sz.TryGetInt64(out var v) ? v : 0;
                        assets.Add(new Px4Asset(name, size, url));
                    }
                }

                releases.Add(new Px4Release(
                    tag,
                    string.IsNullOrWhiteSpace(label) ? tag : label,
                    prerelease,
                    assets.OrderBy(a => a.Name, StringComparer.Ordinal).ToList()));
            }
        }
        return releases;
    }
}

public record Px4Release(string Tag, string Label, bool Prerelease, IReadOnlyList<Px4Asset> Assets);

public record Px4Asset(string Name, long Size, string Url);
