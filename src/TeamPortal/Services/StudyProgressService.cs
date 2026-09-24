using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 学习库进度的读写与统计。
///
/// 为什么不用 localStorage：换设备就丢、清缓存归零、用户能自己改，
/// 拿它做部门完成率或培训依据都是假的。这里全部落在服务端表 StudyProgresses 上。
/// </summary>
public class StudyProgressService
{
    private readonly AppDbContext _db;

    public StudyProgressService(AppDbContext db) { _db = db; }

    /// <summary>本人已完成的课时路径集合。</summary>
    public async Task<HashSet<string>> GetCompletedPaths(int userId)
        => (await _db.StudyProgresses.AsNoTracking()
                .Where(p => p.UserId == userId)
                .Select(p => p.Path)
                .ToListAsync())
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>标记/取消完成。幂等：重复标记不会产生第二条记录。</summary>
    public async Task SetCompleted(int userId, string path, bool completed)
    {
        var existing = await _db.StudyProgresses
            .FirstOrDefaultAsync(p => p.UserId == userId && p.Path == path);

        if (completed && existing is null)
            _db.StudyProgresses.Add(new StudyProgress { UserId = userId, Path = path });
        else if (!completed && existing is not null)
            _db.StudyProgresses.Remove(existing);
        else
            return;   // 状态没变，不写库

        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 该范围内每个课时的完成人数。
    /// 范围语义：公共 = 全队；部门名 = 该部门成员。
    /// </summary>
    public async Task<Dictionary<string, int>> GetCompletionCounts(string scope)
    {
        var userIds = await ScopeUserIds(scope);
        if (userIds.Count == 0) return new Dictionary<string, int>(StringComparer.Ordinal);

        return await _db.StudyProgresses.AsNoTracking()
            .Where(p => userIds.Contains(p.UserId))
            .GroupBy(p => p.Path)
            .Select(g => new { Path = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Path, x => x.Count, StringComparer.Ordinal);
    }

    /// <summary>该范围的成员数（完成率的分母）。</summary>
    public async Task<int> CountScopeMembers(string scope)
        => (await ScopeUserIds(scope)).Count;

    private async Task<List<int>> ScopeUserIds(string scope)
        => scope == StudyLibraryService.PublicScope
            ? await _db.Users.AsNoTracking().Select(u => u.Id).ToListAsync()
            : await _db.Users.AsNoTracking()
                .Where(u => u.Department != null && u.Department.Name == scope)
                .Select(u => u.Id)
                .ToListAsync();
}
