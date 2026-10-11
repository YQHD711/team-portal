using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 分词与打分公式（P1-1）。单独拆出来是因为 KnowledgeSearchService.Index.cs 已经贴着 200 行上限。
/// </summary>
public partial class KnowledgeSearchService
{
    /// <summary>BM25 的 IDF：N=分块数，df=含该 token 的分块数。</summary>
    internal static double Bm25Idf(int chunkCount, int df) =>
        Math.Log(1 + (chunkCount - df + 0.5) / (df + 0.5));

    /// <summary>BM25 的 TF 饱和项（k1=1.5、b=0.75），长度归一用缓存好的平均分块长度。</summary>
    internal static double Bm25Tf(int tf, int chunkTokens, double avgChunkTokens)
    {
        var len = Math.Max(1, chunkTokens);
        var avg = avgChunkTokens <= 0 ? 1 : avgChunkTokens;
        return tf * (Bm25K1 + 1) / (tf + Bm25K1 * (1 - Bm25B + Bm25B * len / avg));
    }

    // 中文友好分词：英文/数字词 + 中文 bigram（索引侧）
    //
    // **刻意不索引中文单字**：内存实测（66MB 语料、66k 分块）显示单字贡献了全部 postings 的约 2/3
    // —— 每个分块几乎都含大多数常用单字，而 BM25 给它们的 IDF 接近 0，对排序没有贡献，纯占内存。
    // 查询侧本来也不下发单字（≥2 字的 query 走 bigram），所以只损失"单字 CJK 查询"这一种极端情况
    // （前端全局搜索要求 q.Length ≥ 2）。改回单字前请先重跑 KnowledgeIndexMemoryProbe。
    private static List<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        var lower = text.ToLowerInvariant();

        foreach (Match m in Regex.Matches(lower, @"[a-z0-9][a-z0-9_-]*"))
            tokens.Add(m.Value);

        var chinese = Regex.Replace(lower, @"[^\p{IsCJKUnifiedIdeographs}]", "");
        for (int i = 0; i < chinese.Length - 1; i++)
            tokens.Add(chinese.Substring(i, 2));

        return tokens;
    }

    // 查询侧分词：英文词 + 中文整串与 bigram（与索引侧 bigram 对齐）
    private static string[] TokenizeQuery(string query)
    {
        var tokens = new List<string>();
        var lower = query.ToLowerInvariant().Trim();

        foreach (Match m in Regex.Matches(lower, @"[a-z0-9][a-z0-9_-]*"))
            tokens.Add(m.Value);

        var chinese = Regex.Replace(lower, @"[^\p{IsCJKUnifiedIdeographs}]", "");
        if (chinese.Length > 0)
        {
            tokens.Add(chinese); // 整串作为一个词（命中同长度的标题/短语时权重更高）
            for (int i = 0; i < chinese.Length - 1; i++)
                tokens.Add(chinese.Substring(i, 2));
        }

        return tokens.Distinct().ToArray();
    }
}
