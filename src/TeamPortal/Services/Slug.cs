using System.Security.Cryptography;

namespace TeamPortal.Services;

/// <summary>
/// 公开 URL 用的短标识。
///
/// 为什么不用自增 ID 当 URL：自增 ID 能被顺序枚举（队里多少人、谁先注册的一目了然），
/// 更麻烦的是**导库/重建库后会重排** —— 旧链接会静默指向**另一个人 / 另一篇文档**，
/// 比 404 难发现得多（你可能对着错的人改档案还没察觉）。
///
/// slug 与主键解耦：不可枚举、稳定、与改名无关。
/// </summary>
public static class Slug
{
    /// <summary>用户前缀</summary>
    public const string UserPrefix = "u_";
    /// <summary>Wiki 项目前缀</summary>
    public const string WikiTaskPrefix = "w_";

    /// <summary>
    /// 8 字节随机 → 16 位小写十六进制（64 bit）。
    /// 队内规模（几百人 / 几千文档）下碰撞概率可忽略，加上唯一索引兜底。
    /// </summary>
    public static string New(string prefix)
        => prefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();

    public static string NewUser() => New(UserPrefix);
    public static string NewWikiTask() => New(WikiTaskPrefix);

    /// <summary>像不像 slug（前缀 + 十六进制）；用于在路由里区分 slug 与旧的数字 ID</summary>
    public static bool LooksLike(string? value, string prefix)
    {
        if (string.IsNullOrEmpty(value) || !value.StartsWith(prefix, StringComparison.Ordinal)) return false;
        for (var i = prefix.Length; i < value.Length; i++)
            if (!Uri.IsHexDigit(value[i])) return false;
        return value.Length > prefix.Length;
    }
}
