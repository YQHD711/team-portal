using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 查询侧的「口语 → 书面语」同义词表 + 疑问词处理（task-21，设置项 <see cref="SettingKey"/>）。
///
/// 为什么需要：知识库文档用的是「领用 / 归还 / 库房 / 库位 / 物料 / 单价 / 完成」，
/// 而队员会问「借 / 还回去 / 仓库 / 货架 / 东西 / 多少钱 / 打勾」—— 最关键的词进不了索引，
/// 于是明明有《物料管理规范》却答"未检索到"。
///
/// 同义词表格式（人能读能改的 JSON 对象，值是字符串或字符串数组，**单行**因为设置页普通项是单行输入框）：
/// <code>{"借":"领用","货架":["库位","货位"],"多少钱":["单价"]}</code>
/// 预处理分三步：① 去掉开头/结尾的疑问词；② 命中键就把正式说法追加进查询（去重、限量）；
/// ③ 泛词（参数/分布/流程…）**不删**，只不作为"有区分度"的信号，并在二次检索时才剔除。
/// </summary>
internal static class SearchSynonyms
{
    public const string SettingKey = "AI:SearchSynonyms";
    public const int MaxAddedTerms = 6;

    /// <summary>
    /// 种子表：每一项都对应知识库/数据库里**真实存在的用词**（领用/归还/库房/库位/物料/单价/完成/学习库）。
    /// 刻意**不收单字「还」**：「还剩多少 / 还有货吗」是常见库存问法，把「还」映射成「归还」会往查询里灌噪音。
    /// </summary>
    public const string DefaultJson =
        "{\"借\":[\"领用\"],\"借用\":[\"领用\"],\"借出\":[\"领用\"],\"借东西\":[\"领用\",\"物料\"],"
        + "\"领东西\":[\"领用\"],\"拿东西\":[\"领用\"],\"还回去\":[\"归还\"],\"还回\":[\"归还\"],\"退还\":[\"归还\"],"
        + "\"仓库\":[\"库房\"],\"货架\":[\"库位\"],\"货位\":[\"库位\"],\"东西\":[\"物料\"],\"器材\":[\"物料\"],\"物资\":[\"物料\"],"
        + "\"价格\":[\"单价\"],\"多少钱\":[\"单价\"],\"打勾\":[\"完成\"],\"勾选\":[\"完成\"],"
        + "\"课程\":[\"学习库\"],\"课时\":[\"学习库\"],\"教程\":[\"学习库\"],\"坏掉\":[\"损坏\"],\"盘点\":[\"清点\"]}";

    /// <summary>疑问/语气词：**只从查询开头或结尾**剔除（中文没有词边界，位置限定能避免把「一下午」拆坏）。</summary>
    private static readonly string[] QuestionWords =
        ["什么", "怎么", "怎样", "如何", "为什么", "为啥", "多少", "哪里", "哪儿", "在哪", "在哪里",
         "是不是", "有没有", "能否", "能不能", "请问", "帮我", "麻烦", "一下", "怎么办", "咋办", "告诉我", "想问", "谢谢"];

    /// <summary>泛词：可能有信息量（所以**不删**），但不足以证明"检索到了相关资料"。</summary>
    private static readonly string[] GenericWords =
        ["参数", "分布", "流程", "信息", "情况", "资料", "内容", "介绍", "说明", "方法", "步骤",
         "相关", "东西", "方面", "问题", "知识", "工作", "部分", "一般", "基本", "总数", "列表"];

    /// <summary>解析同义词表；JSON 坏掉时返回空表（绝不因为一条设置把检索搞挂）。</summary>
    public static Dictionary<string, string[]> Parse(string? json)
        => TryParseTable(json, out var map) ? map : new Dictionary<string, string[]>(StringComparer.Ordinal);

    /// <summary>
    /// 解析同义词表。返回 false = JSON 本身不合法（调用方应退回内置种子表）；
    /// 返回 true 但表为空 = 管理员有意清空（例如 <c>{}</c>），此时就该"没有同义词"。
    /// </summary>
    internal static bool TryParseTable(string? json, out Dictionary<string, string[]> map)
    {
        map = new Dictionary<string, string[]>(StringComparer.Ordinal);
        using var doc = TryParse(json);
        if (doc is null || doc.RootElement.ValueKind != JsonValueKind.Object) return false;

        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            var key = prop.Name.Trim();
            if (key.Length == 0) continue;
            var values = prop.Value.ValueKind switch
            {
                JsonValueKind.String => new[] { prop.Value.GetString() ?? "" },
                JsonValueKind.Array => prop.Value.EnumerateArray()
                    .Where(v => v.ValueKind == JsonValueKind.String).Select(v => v.GetString() ?? "").ToArray(),
                _ => [],
            };
            var cleaned = values.Select(v => v.Trim()).Where(v => v.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
            if (cleaned.Length > 0) map[key] = cleaned;
        }
        return true;
    }

    private static JsonDocument? TryParse(string? json)
    {
        try { return JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? DefaultJson : json); }
        catch { return null; }
    }

    /// <summary>命中键就把正式说法追加到查询末尾（长键优先：先匹配「借东西」再匹配「借」）。</summary>
    public static (string Query, int Added, List<string> Terms) Expand(string query, IReadOnlyDictionary<string, string[]> map)
    {
        var added = new List<string>();
        if (map.Count == 0 || string.IsNullOrWhiteSpace(query)) return (query, 0, added);

        (string, int, List<string>) Result() => added.Count == 0
            ? (query, 0, added)
            : ($"{query} {string.Join(" ", added)}", added.Count, added);

        foreach (var (key, values) in map.OrderByDescending(kv => kv.Key.Length))
        {
            if (!query.Contains(key, StringComparison.Ordinal)) continue;
            foreach (var value in values)
            {
                if (query.Contains(value, StringComparison.Ordinal)) continue;       // 原查询里已经有了
                if (added.Contains(value, StringComparer.Ordinal)) continue;
                if (added.Count >= MaxAddedTerms) return Result();
                added.Add(value);
            }
        }
        return Result();
    }

    /// <summary>去掉开头/结尾的疑问词；过滤后凑不出 bigram（如只问「怎么办」）就**退回原查询**。</summary>
    public static (string Query, bool FellBack) StripQuestionWords(string query)
    {
        var current = (query ?? "").Trim();
        for (var round = 0; round < 4; round++)
        {
            var changed = false;
            foreach (var word in QuestionWords)
            {
                if (current.Length <= word.Length) continue;
                if (current.StartsWith(word, StringComparison.Ordinal))
                {
                    current = current[word.Length..].Trim();
                    changed = true;
                }
                else if (current.EndsWith(word, StringComparison.Ordinal))
                {
                    current = current[..^word.Length].Trim();
                    changed = true;
                }
            }
            if (!changed) break;
        }
        return IsSearchable(current) ? (current, false) : ((query ?? "").Trim(), true);
    }

    /// <summary>能不能凑出一个 bigram / 一个英文数字词（决定过滤结果是否可用）。</summary>
    internal static bool IsSearchable(string text) =>
        Regex.Matches(text ?? "", @"[\p{IsCJKUnifiedIdeographs}]").Count >= 2
        || Regex.IsMatch(text ?? "", @"[a-z0-9]{2,}", RegexOptions.IgnoreCase);

    internal static bool IsGeneric(string token) => GenericWords.Contains(token, StringComparer.Ordinal);

    /// <summary>二次检索用：剔除泛词（保留同义词扩展）；结果与首轮相同则返回 null（不做第二次）。</summary>
    public static string? AlternativeQuery(string cleaned, string firstPassQuery, IReadOnlyList<string> synonymTerms)
    {
        var stripped = cleaned;
        foreach (var word in GenericWords) stripped = stripped.Replace(word, " ");
        stripped = Regex.Replace(stripped, @"\s+", " ").Trim();

        var text = synonymTerms.Count == 0 ? stripped : $"{stripped} {string.Join(" ", synonymTerms)}".Trim();
        return text.Length == 0 || string.Equals(text, firstPassQuery, StringComparison.Ordinal) ? null : text;
    }
}
