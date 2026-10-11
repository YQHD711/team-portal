using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 知识库检索的索引部分（P1-1）：文档切成 ≈<see cref="ChunkSize"/> 字符、相邻重叠
/// <see cref="ChunkOverlap"/> 字符的**分块**；倒排结构不变（token → postings），但 posting 指向
/// **分块**；分块数就是 IDF 的 N（原 _docCount 语义变为分块数）；平均分块长度缓存在快照里。
/// 同文档多分块取 max、snippet 取命中分块（为什么分块：长文档答案在后半段时，整篇截取会答非所问）。
///
/// 内存设计（服务器 1.8G，要求索引增量 &lt; 300MB，**实测见 KnowledgeIndexMemoryProbe**）：
/// 不用 `Dictionary&lt;string, Posting[]&gt;`（实测 66MB 语料要 700MB+），改为**扁平 CSR** ——
/// token 的 64 位哈希 → (offset,count)，postings 落在两个大数组（分块下标 int[] + 词频 byte[]）；
/// 两遍扫描（先数 df 再填）所以峰值也不翻倍；df 超过 <see cref="MaxPostingsPerTerm"/> 的 token
/// 整条丢弃（近似停用词，BM25 的 IDF 接近 0 却是 postings 大头）。
/// 分词与 BM25 公式见 KnowledgeSearchService.Tokenize.cs，摘要见 Snippets.cs。
/// </summary>
public partial class KnowledgeSearchService
{
    public const int ChunkSize = 800;
    public const int ChunkOverlap = 100;
    /// <summary>BM25 参数（规格指定 k1=1.5, b=0.75）。</summary>
    internal const double Bm25K1 = 1.5;
    internal const double Bm25B = 0.75;
    /// <summary>postings 超过这个长度的 token 直接不索引（近似停用词，见类注释）。</summary>
    internal const int MaxPostingsPerTerm = 20000;
    /// <summary>词频用 byte 存；单个分块（800 字）里同一 token 出现 255 次以上极罕见，封顶即可。</summary>
    private const int TfCap = 255;
    /// <summary>postings 下标存在低 32 位，count 在高 16 位。</summary>
    private const int CountShift = 32;
    /// <summary>桥接伪块：内容来自 sidecar，原文文件里没有对应区间（摘要退回整篇找锚点）。</summary>
    private const int BridgeChunkStart = -1;
    /// <summary>虚拟文档分块：正文不在磁盘上（如 P1-2 的学习库索引文档），摘要取自身文本。</summary>
    private const int VirtualChunkStart = -2;

    private static readonly string[] TextPatterns = { "*.md", "*.txt", "*.json", "*.csv", "*.xml" };

    /// <summary>分块元数据。<c>Start &lt; 0</c> 表示非文件分块（桥接伪块 / 虚拟文档）。</summary>
    private readonly record struct ChunkInfo(string Path, int Start, int Length, int TokenCount);

    /// <summary>
    /// 一次重建后的只读索引快照：检索只读它，重建整体替换 —— 读者永远看到自洽的一组数据。
    /// <c>Index</c> 的值是打包的 <c>offset | count &lt;&lt; 32</c>（构建期还会用高 16 位记写入游标），
    /// 解码统一走 <see cref="Unpack"/>；<c>VirtualTexts</c> 是虚拟文档分块的下标 → 正文（出 snippet 用）。
    /// </summary>
    private sealed record IndexSnapshot(
        Dictionary<ulong, long> Index, int[] PostingChunks, byte[] PostingTfs, ChunkInfo[] Chunks,
        Dictionary<int, string> VirtualTexts,
        int ChunkCount, int DocumentCount, double AvgChunkLength, int PrunedTerms, long PostingCount);

    private static readonly IndexSnapshot EmptySnapshot = new(new(), [], [], [], [], 0, 0, 1, 0, 0);

    private volatile IndexSnapshot _snapshot = EmptySnapshot;

    /// <summary>已索引的分块数（IDF 的 N；旧代码里这个数是文档数）。</summary>
    internal int IndexedChunkCount => _snapshot.ChunkCount;
    internal int IndexedDocumentCount => _snapshot.DocumentCount;
    /// <summary>虚拟文档分块数（P1-2 学习库；诊断/单测用）。</summary>
    internal int IndexedVirtualCount => _snapshot.VirtualTexts.Count;
    /// <summary>postings 总条数（内存实测/诊断用）。</summary>
    internal long IndexedPostingCount => _snapshot.PostingCount;
    /// <summary>词典条数（内存实测/诊断用）。</summary>
    internal int IndexedTermCount => _snapshot.Index.Count;
    /// <summary>因 df 过高被丢弃的 token 数（诊断/单测用）。</summary>
    internal int PrunedTermCount => _snapshot.PrunedTerms;

    /// <summary>分块区间：固定窗口 800 / 重叠 100（步长 700），保证相邻块共享 100 字上下文。</summary>
    internal static IEnumerable<(int Start, int Length)> ChunkRanges(int textLength)
    {
        if (textLength <= 0) yield break;
        var step = ChunkSize - ChunkOverlap;
        for (var start = 0; start < textLength; start += step)
        {
            var length = Math.Min(ChunkSize, textLength - start);
            yield return (start, length);
            if (start + length >= textLength) yield break;   // 已到文末，不再产生"只有重叠"的空块
        }
    }

    private void RebuildIndex()
    {
        lock (_lock)
        {
            // 学习库虚拟文档（P1-2）：只在索引里存在，不落盘；两遍扫描共用同一份，保证分块下标对齐
            var virtualDocs = BuildStudyDocs();
            var virtualTexts = new Dictionary<int, string>();

            // ── 第一遍：分词、统计 df（token 出现在几个分块里）、记录分块元数据 ──
            var stats = new Dictionary<ulong, long>(1 << 16);
            var chunks = new List<ChunkInfo>();
            var docs = 0;
            long totalTokens = 0;
            string? lastPath = null;

            foreach (var (path, start, length, text) in AllChunks(virtualDocs))
            {
                if (path != lastPath) { docs++; lastPath = path; }
                var counts = CountTokens(text, out var tokenTotal);
                if (tokenTotal == 0) continue;
                var id = chunks.Count;
                chunks.Add(new ChunkInfo(path, start, length, tokenTotal));
                if (start == VirtualChunkStart) virtualTexts[id] = text;   // 虚拟文档正文要留着出 snippet
                totalTokens += tokenTotal;
                foreach (var token in counts.Keys)
                {
                    stats.TryGetValue(token, out var df);
                    stats[token] = df + 1;
                }
            }

            // ── 剪枝：df 过高的 token（近似停用词）──
            List<ulong>? remove = null;
            foreach (var (token, df) in stats)
                if (df > MaxPostingsPerTerm) (remove ??= []).Add(token);
            if (remove is not null) foreach (var token in remove) stats.Remove(token);
            var pruned = remove?.Count ?? 0;

            // ── 前缀和：把值原地改写成 offset | count << 32（低 48 位之外空着给写入游标）──
            long postingCount = 0;
            foreach (var (token, df) in stats)
            {
                stats[token] = postingCount | (df << CountShift);   // 只改值不动结构，枚举中安全
                postingCount += df;
            }

            // ── 第二遍：按第一遍的同一分块顺序，把 (分块下标, 词频) 填进扁平数组 ──
            var postingChunks = new int[postingCount];
            var postingTfs = new byte[postingCount];
            var chunkId = 0;
            foreach (var (_, _, _, text) in AllChunks(virtualDocs))
            {
                var counts = CountTokens(text, out var tokenTotal);
                if (tokenTotal == 0) continue;
                foreach (var (token, tf) in counts)
                {
                    if (!stats.TryGetValue(token, out var packed)) continue;   // 被剪枝的 token
                    var (offset, count) = Unpack(packed);
                    var cursor = (int)(packed >> 48);
                    if (cursor >= count) continue;                             // 理论上不会发生
                    var at = offset + cursor;
                    postingChunks[at] = chunkId;
                    postingTfs[at] = (byte)Math.Min(TfCap, tf);
                    stats[token] = packed + (1L << 48);                        // 游标 +1
                }
                chunkId++;
            }

            var snapshot = new IndexSnapshot(stats, postingChunks, postingTfs, chunks.ToArray(), virtualTexts,
                chunks.Count, docs, chunks.Count == 0 ? 1 : (double)totalTokens / chunks.Count,
                pruned, postingCount);
            _snapshot = snapshot;
            _logger.LogInformation(
                "Knowledge index rebuilt: {Docs} docs / {Chunks} chunks ({Virtual} virtual), {Terms} terms / {Postings} postings (pruned {Pruned}), avg {Avg:F1} tokens",
                docs, chunks.Count, virtualTexts.Count, stats.Count, postingCount, pruned, snapshot.AvgChunkLength);
        }
    }
}
