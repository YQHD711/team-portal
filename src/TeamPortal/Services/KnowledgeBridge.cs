using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// 中英桥接 sidecar（<c>{原文}.zhidx.json</c>）的读写、判定与提示词。
///
/// 为什么需要：知识库 4600+ 篇里有约 1600 篇英文文档，而检索走的是中文分词（单字 + bigram），
/// **中文提问命中不了英文原文**。给每篇英文文档生成一行中文摘要 sidecar，并把它的中文内容并入
/// 原文的索引文本，中文 query 就能命中；返回的仍是原文（snippet 出自原文）。
///
/// sidecar 是**内部衍生文件**：不进知识库树、不可被 knowledge_read / 内容接口读取，
/// 只被 <see cref="KnowledgeSearchService"/> 当作原文的补充索引内容（见 KnowledgeService.IsInternalFile）。
/// 调度与 AI 调用在 <see cref="KnowledgeBridgingIndexService"/>，这里只放纯逻辑便于单测。
/// </summary>
internal static class KnowledgeBridge
{
    public const string Suffix = ".zhidx.json";
    /// <summary>送给 AI 的正文上限（控制 token）。</summary>
    public const int MaxSourceChars = 6000;

    private static readonly JsonSerializerOptions ReadOpts = new() { PropertyNameCaseInsensitive = true };

    public static bool IsSidecar(string path) => path.EndsWith(Suffix, StringComparison.OrdinalIgnoreCase);

    public static string SidecarPathFor(string sourceFile) => sourceFile + Suffix;

    /// <summary>sidecar 的内容。<c>src</c> 是原文相对路径，便于检索命中后映射回原文/排查。</summary>
    private sealed record BridgeDoc(string? Src, string? T, List<string>? K, string? D);

    public static string BuildJson(string srcRelativePath, string title, IEnumerable<string> keywords, string summary)
        => JsonSerializer.Serialize(new
        {
            src = srcRelativePath,
            t = title,
            k = keywords.Where(k => !string.IsNullOrWhiteSpace(k)).Select(k => k.Trim()).ToArray(),
            d = summary,
        });

    /// <summary>解析 sidecar 并拼成供索引用的中文文本（标题 + 关键词 + 摘要）；读不到/解析失败返回 null。</summary>
    public static string? TryReadIndexText(string sidecarFile)
    {
        try
        {
            if (!File.Exists(sidecarFile)) return null;
            var doc = JsonSerializer.Deserialize<BridgeDoc>(File.ReadAllText(sidecarFile), ReadOpts);
            if (doc is null) return null;
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(doc.T)) parts.Add(doc.T);
            if (doc.K is { Count: > 0 }) parts.Add(string.Join(" ", doc.K));
            if (!string.IsNullOrWhiteSpace(doc.D)) parts.Add(doc.D);
            return parts.Count == 0 ? null : string.Join(" ", parts);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>sidecar 里记的原文相对路径；缺失时调用方按"同名兄弟文件"回退。</summary>
    public static string? TryReadSourcePath(string sidecarFile)
    {
        try
        {
            if (!File.Exists(sidecarFile)) return null;
            return JsonSerializer.Deserialize<BridgeDoc>(File.ReadAllText(sidecarFile), ReadOpts)?.Src;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// 英文文档判定：**无 CJK 字符**，或**ASCII 占比 &gt; 70%**（规格口径）。
    /// 空白不计入分母，避免排版稀疏的文档被误判。
    /// </summary>
    public static bool IsEnglishText(string? text, double asciiRatioThreshold = 0.7)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        int ascii = 0, cjk = 0, total = 0;
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch)) continue;
            total++;
            if (ch <= 0x7F) ascii++;
            if (ch >= 0x4E00 && ch <= 0x9FFF) cjk++;
        }
        if (total == 0) return false;
        return cjk == 0 || (double)ascii / total > asciiRatioThreshold;
    }

    // ── 提示词与解析（AI 调用在 KnowledgeBridgingIndexService） ──

    public const string SummarySystemPrompt = """
        你是知识库检索助手。用户会用中文提问，而这篇文档是英文的。
        为它生成一行 JSON（只输出 JSON，不要代码块、不要解释），格式：
        {"t":"<中文标题>","k":["关键词1","关键词2","关键词3","关键词4","关键词5"],"d":"<不超过60字的中文摘要>"}
        要求：k 用中文关键词（设备名/模块名等专有名词可保留英文），覆盖文档主题与关键概念；
        d 说明这篇文档讲什么、能回答什么问题。
        """;

    /// <summary>拼用户消息：文档相对路径 + 截断后的正文。</summary>
    public static string BuildUserPrompt(string relativePath, string text) =>
        $"文档路径：{relativePath}\n\n文档内容（可能截断）：\n{Truncate(text, MaxSourceChars)}";

    /// <summary>解析 AI 返回的一行 JSON；容忍代码块/前后废话，取第一个 { 到最后一个 }。</summary>
    public static (string Title, List<string> Keywords, string Summary)? ParseSummary(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return null;
        var start = content.IndexOf('{');
        var end = content.LastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try
        {
            using var doc = JsonDocument.Parse(content[start..(end + 1)]);
            var root = doc.RootElement;
            var title = root.TryGetProperty("t", out var t) ? t.GetString() : null;
            var summary = root.TryGetProperty("d", out var d) ? d.GetString() : null;
            var keywords = new List<string>();
            if (root.TryGetProperty("k", out var k) && k.ValueKind == JsonValueKind.Array)
                foreach (var item in k.EnumerateArray())
                    if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
                        keywords.Add(item.GetString()!.Trim());
            if (string.IsNullOrWhiteSpace(title) && keywords.Count == 0 && string.IsNullOrWhiteSpace(summary))
                return null;
            return (title ?? "", keywords, summary ?? "");
        }
        catch { return null; }
    }

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..max] + "\n...(truncated)";

    /// <summary>原子写 sidecar：唯一临时名 + rename，失败不留半截 JSON（与 KnowledgeService 同一态度）。</summary>
    public static void WriteSidecarAtomic(string sidecarPath, string json)
    {
        var dir = Path.GetDirectoryName(sidecarPath);
        if (dir is not null) Directory.CreateDirectory(dir);
        var tmp = $"{sidecarPath}.tmp-{Guid.NewGuid():N}";
        try
        {
            File.WriteAllText(tmp, json);
            File.Move(tmp, sidecarPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* best effort */ }
        }
    }
}
