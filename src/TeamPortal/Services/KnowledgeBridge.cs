using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// 中英桥接 sidecar（<c>{原文}.zhidx.json</c>）的**只读**处理。
///
/// 背景：P0-1 曾提供「逐篇调 AI 给英文文档生成中文摘要 sidecar」的能力，让中文提问能命中英文原文。
/// task-13 用户决定**彻底移除摘要生成**（知识库英文文档太多，token 花费不值得），
/// 所以生成入口（扫描/提示词/解析/写入/限流/重试/上限/调度/手动端点）已全部删除。
///
/// **只保留读取/索引路径**：线上从未真正跑过生成（91 篇全量验证一直挂着），这条路径目前是空转的、
/// 不改变任何行为；而它与 P1-1 的分块索引（"桥接伪块"）耦合，删它收益为零、风险不小。
/// 因此已有的 <c>.zhidx.json</c> 继续被 <see cref="KnowledgeSearchService"/> 并入原文索引，
/// 中文提问对**已有 sidecar 的文档**依然有效；以后不再产生新的 sidecar。
///
/// sidecar 是内部衍生文件：不进知识库树、不可被 knowledge_read / 内容接口读取
/// （见 KnowledgeService.IsInternalFile）。
/// </summary>
internal static class KnowledgeBridge
{
    public const string Suffix = ".zhidx.json";

    private static readonly JsonSerializerOptions ReadOpts = new() { PropertyNameCaseInsensitive = true };

    public static bool IsSidecar(string path) => path.EndsWith(Suffix, StringComparison.OrdinalIgnoreCase);

    public static string SidecarPathFor(string sourceFile) => sourceFile + Suffix;

    /// <summary>sidecar 的历史格式（生成端已移除，这里只为了读已有文件）。</summary>
    private sealed record BridgeDoc(string? Src, string? T, List<string>? K, string? D);

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
}
