using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// RAG 空转率统计：从 SystemLogs（Category=ai）里解析 <see cref="RagLog"/> 写下的检索行与上下文行。
/// 只读、不写库；给管理端「AI 检索统计」卡片用。解析口径与写入完全同源，避免文字格式漂移导致统计恒为 0。
/// </summary>
public class RagStatsService
{
    public const int WindowDays = 7;
    public const int MaxRecentEmpty = 10;
    private const int MaxRows = 20000;   // 兜底：7 天日志异常膨胀时不至于把内存拉满

    private readonly AppDbContext _db;

    public RagStatsService(AppDbContext db) => _db = db;

    public record EmptyQuery(string Query, DateTime At);

    public record RagStatsInfo(
        int Days, int SearchCount, int EmptyCount, double EmptyRatePct, int ReturnedTotal,
        IReadOnlyList<EmptyQuery> RecentEmpty,
        int ContextCount, double AvgContextChars, double AvgUsedDocs);

    public async Task<RagStatsInfo> GetAsync(DateTime? nowUtc = null)
    {
        var since = (nowUtc ?? DateTime.UtcNow).AddDays(-WindowDays);
        var rows = await _db.SystemLogs
            .Where(l => l.Category == RagLog.Category && l.CreatedAt >= since && l.Message.StartsWith("RAG "))
            .OrderByDescending(l => l.CreatedAt)
            .Take(MaxRows)
            .Select(l => new { l.Message, l.CreatedAt })
            .ToListAsync();

        int searches = 0, empties = 0, returnedTotal = 0, contexts = 0, contextChars = 0, contextUsed = 0;
        var recentEmpty = new List<EmptyQuery>();
        foreach (var row in rows)   // 已按时间倒序，空结果 query 天然按"最近优先"
        {
            if (RagLog.TryParseSearch(row.Message, out var query, out _, out var returned, out var empty))
            {
                searches++;
                returnedTotal += returned;
                if (!empty) continue;
                empties++;
                if (recentEmpty.Count < MaxRecentEmpty) recentEmpty.Add(new EmptyQuery(query, row.CreatedAt));
            }
            else if (RagLog.TryParseContext(row.Message, out var chars, out var used))
            {
                contexts++;
                contextChars += chars;
                contextUsed += used;
            }
        }

        return new RagStatsInfo(
            Days: WindowDays,
            SearchCount: searches,
            EmptyCount: empties,
            EmptyRatePct: searches == 0 ? 0 : Math.Round(empties * 100.0 / searches, 1),
            ReturnedTotal: returnedTotal,
            RecentEmpty: recentEmpty,
            ContextCount: contexts,
            AvgContextChars: contexts == 0 ? 0 : Math.Round((double)contextChars / contexts, 1),
            AvgUsedDocs: contexts == 0 ? 0 : Math.Round((double)contextUsed / contexts, 1));
    }
}
