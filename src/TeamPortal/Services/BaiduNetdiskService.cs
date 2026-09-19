using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// Baidu Netdisk (百度网盘) integration for large file cloud storage.
/// Uses OAuth 2.0 with client credentials flow.
/// </summary>
/// <remarks>
/// 主类部分：字段、常量、HTTP 响应读取、错误判定、日志脱敏。
/// 其余职责拆分为 partial：OAuth（授权/令牌）、Upload（分块上传）、Files（下载/列表）、
/// Manage（删除/建目录/配额）、Backup（系统备份）。
/// </remarks>
public partial class BaiduNetdiskService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly SettingsService _settings;
    private readonly LogService _log;
    private static string? _accessToken;
    private static DateTime _tokenExpiry = DateTime.MinValue;
    private static readonly SemaphoreSlim _tokenSemaphore = new(1, 1);

    private const string OAuthUrl = "https://openapi.baidu.com/oauth/2.0/token";
    private const string AuthUrl = "https://openapi.baidu.com/oauth/2.0/authorize";
    private const string DeviceAuthUrl = "https://openapi.baidu.com/oauth/2.0/device/code";
    private const string ApiBase = "https://pan.baidu.com/rest/2.0/xpan";
    private const string UploadBase = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
    private const string RedirectUri = "oob";

    /// <summary>系统在百度网盘中的根目录（百度开放平台要求 /apps/ 前缀）</summary>
    public const string RootDir = "/apps/team-portal";
    /// <summary>用户上传文件的默认目录</summary>
    public const string DefaultUploadDir = RootDir + "/user-data/documents";

    private static string TokenFile => Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "baidu-token.json"));

    public BaiduNetdiskService(HttpClient http, IConfiguration config, LogService log, SettingsService settings)
    {
        _http = http;
        _config = config;
        _log = log;
        _settings = settings;
    }

    /// <summary>Read HTTP response as UTF-8 string, bypassing charset header parsing issues (Baidu server sends "utf8" not "utf-8").</summary>
    private static async Task<string> ReadBodyAsync(HttpContent content, CancellationToken ct = default)
    {
        var bytes = await content.ReadAsByteArrayAsync(ct);
        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>access_token / refresh_token 的值,用于日志与异常信息脱敏(键名保留,值替换为 ***)。</summary>
    private static readonly Regex TokenValuePattern = new(
        @"(?<p>(?:access_token|refresh_token)\s*[""']?\s*[:=]\s*[""']?)[^""'&,\s}]+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// 日志/异常里出现的响应体先脱敏。
    /// OAuth 交换与刷新的响应体含 access_token / refresh_token,直接落库等于把凭证写进审计日志。
    /// </summary>
    internal static string RedactSecrets(string body) => TokenValuePattern.Replace(body, "${p}***");

    /// <summary>
    /// 宽容读取 JSON 字段为整数：百度接口对同一字段时而返回数字、时而返回数字字符串。
    /// 直接 GetInt32() 遇字符串会抛 "requires an element of type 'Number'" 中断流程。
    /// 解析不出来返回 null（由调用方决定是当作成功还是失败）。
    /// </summary>
    internal static int? JsonIntOrString(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Number => element.TryGetInt32(out var n) ? n : null,
        JsonValueKind.String => int.TryParse(element.GetString(), out var s) ? s : null,
        _ => null,
    };

    /// <summary>
    /// 宽容读取 JSON 字段为字符串：precreate 的 block_list 元素、部分响应里的
    /// uploadid / md5 都可能是数字。GetString() 遇到数字会抛
    /// "The requested operation requires an element of type 'String', but the target element has type 'Number'"
    /// ——该异常曾让整个系统备份上传失败并回退本地副本。
    /// </summary>
    internal static string? JsonStringOrNumber(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.GetRawText(),
        _ => null,
    };

    /// <summary>
    /// Check Baidu API response for errno != 0. Returns true if no error.
    /// On auth errors (6, 111, -6), resets cached token for re-auth.
    /// </summary>
    private bool CheckBaiduError(JsonElement root, string operation, string rawBody)
    {
        if (!root.TryGetProperty("errno", out var errnoElement))
            return true;

        // 类型不符(errno 为字符串等)时无法判定错误码，按成功处理，不阻断业务
        var code = JsonIntOrString(errnoElement);
        if (code is null or 0)
            return true;

        if (code == 6 || code == 111 || code == -6)
        {
            _accessToken = null;
            _tokenExpiry = DateTime.MinValue;
            _log.Warn("baidu", $"[{operation}] Token expired (errno={code}), reset for re-auth");
        }

        _log.Error("baidu", $"[{operation}] API error errno={code}: {RedactSecrets(rawBody[..Math.Min(300, rawBody.Length)])}");
        return false;
    }
}
