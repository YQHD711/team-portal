using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// 查询侧（task-21）：查询预处理（疑问词 + 同义词扩展）→ 首轮检索 → **弱结果自动二次检索**并合并去重。
///
/// **不动索引结构**：不加中文单字索引、不改 CSR/内存布局、不引入 embedding。
/// 「弱」的判据是**有没有"有区分度的词"真的命中**（df 低的词），而不是分数阈值——
/// 这样「怎么借东西」「数传参数」这种"只被通用 bigram 命中"的情况能被识别出来（线上实测 hits=170/2452 却答未检索到）。
///
/// 索引结构/分词见 KnowledgeSearchService.Index.cs / .Tokenize.cs，同义词表见 SearchSynonyms.cs。
/// </summary>
public partial class KnowledgeSearchService
{
    private const int SynonymCacheSeconds = 60;
    private readonly object _synLock = new();
    private Dictionary<string, string[]>? _synonymMap;
    private DateTime _synonymLoadedAt = DateTime.MinValue;

    /// <summary>一次检索的完整结果：给调用方判断"该不该提示模型换词"用。</summary>
    public sealed record SearchOutcome(List<KbResult> Results, bool Weak, int Hits, int SynonymAdds, bool Relaxed);

    /// <summary>兼容旧调用方：只要结果。</summary>
    public List<KbResult> Search(string query, int topK, string? role, string? department, int userId = 0)
        => SearchDetailed(query, topK, role, department, userId).Results;

    /// <summary>
    /// 检索（含预处理与弱结果二次检索）。
    ///
    /// BM25 检索本身要求**在计分前按调用者角色/部门过滤**（索引覆盖全部部门目录），
    /// 放到 Take(topK) 之后再过滤会让有权文档被无权文档挤掉，也堵不住泄露。
    /// </summary>
    public SearchOutcome SearchDetailed(string query, int topK, string? role, string? department, int userId = 0)
    {
        var snap = _snapshot;   // 一次取快照：重建期间也不会读到半新半旧的索引
        var (cleaned, fellBack) = SearchSynonyms.StripQuestionWords(query ?? "");
        var (firstQuery, synonymAdds, synonymTerms) = SearchSynonyms.Expand(cleaned, Synonyms());

        var first = PassResult.Empty;
        if (snap.ChunkCount > 0 && TokenizeQuery(firstQuery).Length > 0)
            first = ExecutePass(firstQuery, topK, snap, role, department, userId);

        // 空索引 / 查询被过滤得一个 token 都没有 → 如实记空结果（并标出是否退回了原查询）
        if (first.Tokens.Length == 0)
        {
            LogSearchLine(firstQuery, 0, 0, weak: true, synonymAdds, fellBack);
            return new SearchOutcome([], Weak: true, Hits: 0, SynonymAdds: synonymAdds, Relaxed: fellBack);
        }

        var weak = first.Results.Count == 0 || !HasDistinctiveHit(first.Tokens, first.Scores, snap);

        var results = first.Results;
        var relaxed = fellBack;
        if (weak && SearchSynonyms.AlternativeQuery(cleaned, firstQuery, synonymTerms) is { } alternate)
        {
            var second = ExecutePass(alternate, topK, snap, role, department, userId);
            results = Merge(results, second.Results, topK);   // 按文档取最高分，同一篇只占一个名额
            relaxed = true;
        }

        LogSearchLine(firstQuery, first.Hits, results.Count, weak, synonymAdds, relaxed);
        return new SearchOutcome(results, weak, first.Hits, synonymAdds, relaxed);
    }

    private sealed record PassResult(List<KbResult> Results, int Hits, string[] Tokens, Dictionary<int, double> Scores)
    {
        public static readonly PassResult Empty = new([], 0, [], []);
    }

    private PassResult ExecutePass(string query, int topK, IndexSnapshot snap, string? role, string? department, int userId)
    {
        var queryTokens = TokenizeQuery(query);
        var invisibleProjects = InvisibleProjectNames(role, department, userId);
        bool Allowed(string path) =>
            KnowledgeAcl.CanAccess(path, role, department) &&
            !KnowledgeAcl.IsInvisibleWikiProject(path, invisibleProjects);

        var chunkScores = new Dictionary<int, double>();
        foreach (var token in queryTokens)
        {
            if (!snap.Index.TryGetValue(Hash(token), out var packed)) continue;
            var (offset, count) = Unpack(packed);
            var idf = Bm25Idf(snap.ChunkCount, count);
            for (var i = 0; i < count; i++)
            {
                var at = offset + i;
                var chunkId = snap.PostingChunks[at];
                var chunk = snap.Chunks[chunkId];
                if (!Allowed(chunk.Path)) continue;
                var score = idf * Bm25Tf(snap.PostingTfs[at], chunk.TokenCount, snap.AvgChunkLength);
                chunkScores.TryGetValue(chunkId, out var existing);
                chunkScores[chunkId] = existing + score;
            }
        }

        // 同一文档多分块取 max（规格要求）；命中分块同时用于取 snippet
        var best = new Dictionary<string, (double Score, int Chunk)>(StringComparer.Ordinal);
        foreach (var (chunkId, score) in chunkScores)
        {
            var path = snap.Chunks[chunkId].Path;
            if (!best.TryGetValue(path, out var current) || score > current.Score)
                best[path] = (score, chunkId);
        }

        var results = new List<KbResult>();
        foreach (var (path, hit) in best.OrderByDescending(x => x.Value.Score).Take(topK))
        {
            results.Add(new KbResult
            {
                Path = path,
                Snippet = SnippetForChunk(snap, hit.Chunk, query, queryTokens),
                Score = hit.Score,
            });
        }
        return new PassResult(results, chunkScores.Count, queryTokens, chunkScores);
    }

    /// <summary>
    /// 「弱」= 没有任何**有区分度**的词命中结果。区分度按 df 卡：df 超过 max(20, 分块数/100) 的算通用词
    /// （线上 66k 分块时阈值约 660：「参数」这种动辄命中上千分块的词不合格，「领用」这类才合格）。
    /// 命中条数为 0 当然也算弱。
    /// </summary>
    private static bool HasDistinctiveHit(string[] tokens, Dictionary<int, double> scores, IndexSnapshot snap)
    {
        var maxDf = Math.Max(20, snap.ChunkCount / 100);
        foreach (var token in tokens)
        {
            if (SearchSynonyms.IsGeneric(token)) continue;
            if (!snap.Index.TryGetValue(Hash(token), out var packed)) continue;
            var (offset, count) = Unpack(packed);
            if (count == 0 || count > maxDf) continue;
            for (var i = 0; i < count; i++)
                if (scores.ContainsKey(snap.PostingChunks[offset + i])) return true;
        }
        return false;
    }

    private static List<KbResult> Merge(List<KbResult> first, List<KbResult> second, int topK)
    {
        var byPath = new Dictionary<string, KbResult>(StringComparer.Ordinal);
        foreach (var r in first.Concat(second))
        {
            if (!byPath.TryGetValue(r.Path, out var existing) || r.Score > existing.Score) byPath[r.Path] = r;
        }
        return byPath.Values.OrderByDescending(r => r.Score).Take(topK).ToList();
    }

    /// <summary>同义词表读取（60 秒缓存；设置改了最多一分钟生效）。读不到就用内置种子表。</summary>
    private Dictionary<string, string[]> Synonyms()
    {
        lock (_synLock)
        {
            if (_synonymMap is not null && DateTime.UtcNow - _synonymLoadedAt < TimeSpan.FromSeconds(SynonymCacheSeconds))
                return _synonymMap;
        }

        string? raw = null;
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            raw = db.SystemSettings.AsNoTracking().FirstOrDefault(s => s.Key == SearchSynonyms.SettingKey)?.Value;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "读取 {Key} 失败，本次使用内置同义词表", SearchSynonyms.SettingKey);
        }

        Dictionary<string, string[]> map;
        if (string.IsNullOrWhiteSpace(raw))
        {
            map = SearchSynonyms.Parse(SearchSynonyms.DefaultJson);
        }
        else if (!SearchSynonyms.TryParseTable(raw, out map))
        {
            // 管理员手改写坏了：退回内置表，别让同义词能力整段消失（{ } 这种合法的"清空"仍然生效）
            _logger.LogWarning("{Key} 不是合法 JSON，本次退回内置同义词表", SearchSynonyms.SettingKey);
            map = SearchSynonyms.Parse(SearchSynonyms.DefaultJson);
        }
        lock (_synLock)
        {
            _synonymMap = map;
            _synonymLoadedAt = DateTime.UtcNow;
        }
        return map;
    }

    /// <summary>RAG 可观测性：一次检索一行（追加 weak/syn/relax；原有字段保持在前，RagStats 仍能解析）。</summary>
    private void LogSearchLine(string query, int hits, int returned, bool weak, int synonymAdds, bool relaxed) =>
        _log.Info(RagLog.Category, RagLog.SearchLine(query, hits, returned, returned == 0, weak, synonymAdds, relaxed ? 1 : 0));
}
