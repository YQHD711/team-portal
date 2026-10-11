namespace TeamPortal.Services;

/// <summary>
/// 索引构建的小工具（从 KnowledgeSearchService.Index.cs 拆出来，那个文件已经贴着 200 行上限）：
/// 分块内词频统计、CSR 打包值的解包、token 的 64 位哈希。
/// </summary>
public partial class KnowledgeSearchService
{
    /// <summary>一个分块内各 token 的词频（键是 token 的 64 位哈希）。</summary>
    private static Dictionary<ulong, int> CountTokens(string text, out int total)
    {
        var counts = new Dictionary<ulong, int>();
        total = 0;
        foreach (var token in Tokenize(text))
        {
            total++;
            var hash = Hash(token);
            counts.TryGetValue(hash, out var count);
            counts[hash] = count + 1;
        }
        return counts;
    }

    /// <summary>解包 <c>offset | count &lt;&lt; 32</c>（高 16 位是构建期游标，查询时忽略）。</summary>
    private static (int Offset, int Count) Unpack(long packed) =>
        ((int)(packed & 0xFFFFFFFF), (int)((packed >> CountShift) & 0xFFFF));

    /// <summary>64 位 FNV-1a：用哈希而不是 token 字符串做键，省掉几百万个词条的字符串与比较开销。</summary>
    private static ulong Hash(string token)
    {
        var hash = 14695981039346656037UL;
        foreach (var ch in token)
        {
            hash ^= ch;
            hash *= 1099511628211UL;
        }
        return hash;
    }
}
