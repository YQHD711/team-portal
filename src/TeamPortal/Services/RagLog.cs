using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// RAG 可观测性的日志行格式（写与读共用一套，避免"写的时候改了格式、统计就全解析不到"）。
///
/// 写入：<c>KnowledgeSearchService.Search</c>（每次检索）与 <c>AiProxyService.ChatStream</c>（注入上下文后）。
/// 读取：<c>RagStatsService</c> 从 SystemLogs（Category=ai）里解析出检索次数/空转率/空结果 query。
/// </summary>
internal static class RagLog
{
    public const string Category = "ai";
    public const string SearchPrefix = "RAG search: ";
    public const string ContextPrefix = "RAG context: ";
    /// <summary>工具轮统计（task-16）：迭代了几轮、调了几个工具、返回多少字符、都调了什么。</summary>
    public const string ToolsPrefix = "RAG tools: ";
    private const int QueryMaxChars = 40;

    /// <summary>
    /// q 用**贪婪**匹配：登录的 query 里万一含有 " hits=" 之类字样，也从行尾的最后一个后缀取值，
    /// 不会把统计解析歪掉。task-21 起行尾会追加 <c>weak/syn/relax</c>，所以尾部整体做成可选。
    /// </summary>
    private static readonly Regex SearchRx = new(
        @"^RAG search: q=(?<q>.*) hits=(?<hits>\d+) returned=(?<ret>\d+) empty=(?<empty>True|False)"
        + @"(?: weak=(?<weak>True|False) syn=(?<syn>\d+) relax=(?<relax>\d+))?$",
        RegexOptions.Compiled | RegexOptions.Singleline);

    private static readonly Regex ContextRx = new(
        @"^RAG context: chars=(?<chars>\d+) used=(?<used>\d+)$", RegexOptions.Compiled);

    /// <summary>检索统计行：hits=命中词条数（scores 字典条数），returned=最终返回条数，empty=是否空结果。</summary>
    public static string SearchLine(string query, int hits, int returned, bool empty) =>
        SearchLine(query, hits, returned, empty, weak: false, synonymAdds: 0, relaxed: 0);

    /// <summary>
    /// task-21 起的检索行：在原字段后面**追加** weak（是否只被通用词命中）/syn（追加了几个同义词）/
    /// relax（是否做了二次检索或退回了原查询）。原字段位置不动，老解析（RagStatsService）不受影响。
    /// </summary>
    public static string SearchLine(string query, int hits, int returned, bool empty,
        bool weak, int synonymAdds, int relaxed) =>
        $"{SearchPrefix}q={Sanitize(query)} hits={hits} returned={returned} empty={empty}"
        + $" weak={weak} syn={synonymAdds} relax={relaxed}";

    /// <summary>上下文统计行：chars=注入的上下文长度，used=实际注入的文档数。</summary>
    public static string ContextLine(int chars, int used) => $"{ContextPrefix}chars={chars} used={used}";

    /// <summary>
    /// 工具轮统计行：rounds=跑了几轮工具请求，calls=实际执行了几个工具，chars=工具返回总字符（预算），
    /// tools=各工具名计数。**不记录任何文档正文**（只记名字，避免把知识库内容写进日志）。
    /// </summary>
    public static string ToolsLine(int rounds, int calls, int chars, IEnumerable<string> toolNames)
    {
        var summary = toolNames.GroupBy(n => n, StringComparer.Ordinal)
            .Select(g => $"{g.Key}×{g.Count()}")
            .DefaultIfEmpty("none");
        return $"{ToolsPrefix}rounds={rounds} calls={calls} chars={chars} tools={string.Join(",", summary)}";
    }

    /// <summary>换行会破坏日志行、也让"前 40 字"失去意义；统一压成空格并截断。</summary>
    private static string Sanitize(string? query)
    {
        var flat = Regex.Replace(query ?? "", @"\s+", " ").Trim();
        return flat.Length <= QueryMaxChars ? flat : flat[..QueryMaxChars] + "…";
    }

    public static bool TryParseSearch(string message, out string query, out int hits, out int returned, out bool empty)
    {
        query = "";
        hits = 0;
        returned = 0;
        empty = false;
        var m = SearchRx.Match(message ?? "");
        if (!m.Success) return false;
        query = m.Groups["q"].Value;
        hits = int.Parse(m.Groups["hits"].Value);
        returned = int.Parse(m.Groups["ret"].Value);
        empty = m.Groups["empty"].Value == "True";
        return true;
    }

    public static bool TryParseContext(string message, out int chars, out int used)
    {
        chars = 0; used = 0;
        var m = ContextRx.Match(message ?? "");
        if (!m.Success) return false;
        chars = int.Parse(m.Groups["chars"].Value);
        used = int.Parse(m.Groups["used"].Value);
        return true;
    }
}
