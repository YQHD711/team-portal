namespace TeamPortal.Services;

/// <summary>固件来源。客户端只能传这两个字面量，服务端据此选择白名单上游，绝不接受任意 URL。</summary>
public static class FirmwareSource
{
    public const string ArduPilot = "ardupilot";
    public const string Px4 = "px4";

    public static bool IsKnown(string? source) => source is ArduPilot or Px4;

    public static string Label(string source) => source == Px4 ? "PX4" : "ArduPilot";

    /// <summary>ArduPilot 机型目录白名单（不含 Tools 等开发目录）。值为官网 /{Key}/ 路径段。</summary>
    public static readonly (string Key, string Label)[] ArduPilotVehicles =
    [
        ("Plane", "固定翼 Plane"),
        ("Copter", "多旋翼 Copter"),
        ("Heli", "直升机 Heli"),
        ("Rover", "地面车 Rover"),
        ("Sub", "水下 Sub"),
        ("Blimp", "飞艇 Blimp"),
        ("AntennaTracker", "天线追踪 AntennaTracker"),
        ("AP_Periph", "外设节点 AP_Periph"),
    ];
}

/// <summary>代理上游时固定的请求头。GitHub REST API 对缺少 User-Agent 的请求直接 403
/// （"Request forbidden by administrative rules"），而 .NET HttpClient 默认不发 UA。</summary>
public static class FirmwareUpstream
{
    public const string UserAgent = "TeamPortal-Firmware/1.0";
    public const string GitHubAccept = "application/vnd.github+json";
}

/// <summary>Apache 目录列表的一行。/Vehicles/stable/Pixhawk6X/ 这类页面由 autotest 生成，结构固定。</summary>
public record FirmwareListingEntry(string Name, string Href, bool IsDirectory, long? Size);

public record FirmwareVersion(string Id, string Label, bool Prerelease);

public record FirmwareBoard(string Name, long? Size);

/// <summary>可下载的固件文件。Kind 决定前端排序与默认选中项。</summary>
public record FirmwareAsset(string Name, string Kind, string Label, long? Size);

/// <summary>校验通过后的最终下载目标：URL 由目录数据推导（ArduPilot 拼接 / PX4 取 release 资产地址）。</summary>
public record FirmwareTarget(
    string Source,
    string? Vehicle,
    string Version,
    string Board,
    FirmwareAsset Asset,
    string Url,
    string FileName);

/// <summary>目录路径段白名单校验：挡目录穿越与 URL 注入（纵深防御，真正的准入是「必须在目录里查到」）。</summary>
public static class FirmwareSegments
{
    public const int MaxLength = 80;

    public static bool IsSafe(string? segment)
    {
        if (string.IsNullOrEmpty(segment) || segment.Length > MaxLength) return false;
        if (segment.Contains("..")) return false;
        if (segment.StartsWith('-') || segment.StartsWith('+')) return false;
        foreach (var c in segment)
        {
            var ok = char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-' or '+';
            if (!ok) return false;
        }
        return true;
    }
}
