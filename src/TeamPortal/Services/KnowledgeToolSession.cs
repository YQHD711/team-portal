using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// 聊天里模型**自主调用**的只读知识库工具（task-16）：<c>search_knowledge</c> 与 <c>read_document</c>。
///
/// 为什么需要：单次全局 top-k 分块检索天生答不了「整篇 45k 字的年终总结讲了什么」（模型只能看到 0.8%）。
/// 现在模型可以自己判断"不够"，再用更细的词检索、或**分页翻完**某份文档。
///
/// 一次提问一个会话（<see cref="KnowledgeToolSession"/> 实例），持有：
///   - **ACL 快照**：允许读取的路径 = <c>KnowledgeService.GetTree(role, dept, uid)</c>（与检索同一套 ACL，
///     含跨部门与不可见 wiki 项目的过滤），一次提问只扫一次树；
///   - **字符预算**：工具返回总量 ≤ <see cref="MaxTotalChars"/>，超了就拒绝继续给新内容（模型只能拿已有资料作答）；
///   - 计数：调用次数与工具名（给 RagLog 做可观测性，不记录正文）。
///
/// 工具是**只读**的：没有写接口、不读 <c>data/</c> 之外的任何文件（绝对路径 / <c>..</c> / 盘符 / ADS 一律拒绝）。
/// </summary>
public sealed partial class KnowledgeToolSession
{
    /// <summary>单轮最多执行多少个工具调用（多出来的回错误，但仍要给每个 tool_call 回一条消息）。</summary>
    public const int MaxCallsPerRound = 3;
    /// <summary>
    /// 本次提问所有工具返回内容的字符总预算。
    ///
    /// 为什么是 48000 而不是更小的值：本任务要解决的正是「45,457 字的年终总结只被看到 0.8%」——
    /// 如果总预算比文档还小，模型用工具也读不完，验收（最后一页能读完）根本不成立。
    /// 48000 ≈ 能读完那份 45k 字总结（6 页 × 8000），最坏约 2-3 万输入 token，仍在可控范围。
    /// </summary>
    public const int MaxTotalChars = 48000;
    /// <summary>单次 read_document 单页字符上限（也是默认值：模型别一页一页挤牙膏）。</summary>
    public const int MaxPageChars = 8000;
    /// <summary>search_knowledge 返回条数上限。</summary>
    public const int MaxSearchResults = 8;
    private const int DefaultTopK = 5;
    private const int DefaultPageChars = MaxPageChars;
    private const int MaxSnippetChars = 1200;

    /// <summary>
    /// 中文**不要**转成 \uXXXX：默认编码器会把 1 个汉字变成 6 个字符，
    /// 既让模型看到一堆转义转不动，也会把字符预算放大 6 倍（8 千字的中文页直接爆预算）。
    /// </summary>
    private static readonly JsonSerializerOptions WriteOpts = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly KnowledgeSearchService _search;
    private readonly KnowledgeService _knowledge;
    private readonly string? _role;
    private readonly string? _department;
    private readonly int _userId;

    public KnowledgeToolSession(KnowledgeSearchService search, KnowledgeService knowledge,
        string? role, string? department, int userId)
    {
        _search = search;
        _knowledge = knowledge;
        _role = role;
        _department = department;
        _userId = userId;
    }

    /// <summary>已用掉的返回字符数（预算控制 + 可观测性）。</summary>
    public int SpentChars { get; private set; }

    /// <summary>执行一次工具调用，返回给模型的 JSON 字符串（出错也是 JSON，模型能读懂并改策略）。</summary>
    public string Execute(string name, string argsJson)
    {
        try
        {
            using var args = JsonDocument.Parse(string.IsNullOrWhiteSpace(argsJson) ? "{}" : argsJson);
            var root = args.RootElement;
            return name switch
            {
                "search_knowledge" => SearchKnowledge(Str(root, "query"), Int(root, "top_k")),
                "read_document" => ReadDocument(Str(root, "path"), Int(root, "offset"), Int(root, "length")),
                _ => Error($"未知工具：{name}（只有 search_knowledge / read_document）"),
            };
        }
        catch (Exception ex)
        {
            return Error($"工具参数解析失败：{ex.Message}");
        }
    }

    private string SearchKnowledge(string? query, int? topK)
    {
        if (string.IsNullOrWhiteSpace(query)) return Error("query 不能为空");
        var k = Math.Clamp(topK ?? DefaultTopK, 1, MaxSearchResults);
        var hits = _search.Search(query.Trim(), k, _role, _department, _userId)
            .Select(h => new { path = h.Path, snippet = Clip(h.Snippet, MaxSnippetChars), score = Math.Round(h.Score, 2) })
            .ToList();
        return Result(JsonSerializer.Serialize(new { query = query.Trim(), count = hits.Count, results = hits }, WriteOpts));
    }

    private string ReadDocument(string? path, int? offset, int? length)
    {
        if (string.IsNullOrWhiteSpace(path)) return Error("path 不能为空");
        var normalized = path.Replace('\\', '/').Trim();
        // 越界防护：绝对路径 / 盘符 / ADS / . 与 .. 段一律拒绝（GetContent 也会挡，这里给出明确错误）
        if (normalized.StartsWith('/') || normalized.Contains(':')
            || normalized.Split('/').Any(seg => seg is "." or ".."))
            return Error("path 必须是知识库内的相对路径");

        if (!AllowedPaths().Contains(normalized)) return Error("文档不存在，或者你没有权限读取它");
        var content = _knowledge.GetContent(normalized);
        if (content is null) return Error("文档不存在或不可读");

        var off = offset ?? 0;
        if (off < 0) return Error("offset 不能为负数");
        if (off > content.Length) return Error($"offset 超出文档长度（totalChars={content.Length}）");
        var len = length ?? DefaultPageChars;
        if (len <= 0) return Error("length 必须为正数");
        if (len > MaxPageChars) return Error($"length 超过单页上限（{MaxPageChars} 字符）");

        var take = Math.Min(len, content.Length - off);
        return Result(JsonSerializer.Serialize(new
        {
            path = normalized,
            totalChars = content.Length,
            offset = off,
            length = take,
            hasMore = off + take < content.Length,
            content = content.Substring(off, take),
        }, WriteOpts));
    }

    /// <summary>预算控制：超出总量就不再给新内容（不截断 JSON，保持模型能解析）。</summary>
    private string Result(string json)
    {
        if (SpentChars + json.Length > MaxTotalChars)
            return Error($"本次提问的工具返回内容已达上限（{MaxTotalChars} 字符），请基于已有资料作答");
        SpentChars += json.Length;
        return json;
    }

    private static string Error(string message) => JsonSerializer.Serialize(new { error = message }, WriteOpts);

    private static string Clip(string? text, int max)
    {
        var s = text ?? "";
        return s.Length <= max ? s : s[..max] + "…";
    }

    private static string Str(JsonElement root, string key) => root.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";
    private static int? Int(JsonElement root, string key)
        => root.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null;
}
