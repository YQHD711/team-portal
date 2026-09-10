using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>归档导出结果：本地 CSV 路径 + 已覆盖的最大 Id（null = 未归档任何行）+ 行数 + 是否被单次上限截断</summary>
public record LogArchive(string Path, long? MaxId, int Count, bool Truncated);

/// <summary>LogService — CSV 导出与归档。</summary>
public partial class LogService
{
    /// <summary>单次归档行数上限：超出部分留待下次归档，避免一次性把大表读进内存</summary>
    public const int ArchiveRowLimit = 200_000;
    private const int ArchivePageSize = 5_000;

    private static string CsvField(string? v) => $"\"{(v ?? "").Replace("\"", "\"\"")}\"";

    /// <summary>操作日志 CSV 导出(时间,操作人,操作类型,目标类型,目标,数据,IP)</summary>
    public async Task<string> ExportOperationsCsv(string? user = null, string? action = null,
        DateTime? from = null, DateTime? to = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.OperationLogs.AsQueryable();
        if (!string.IsNullOrEmpty(user)) query = query.Where(o => o.UserName == user);
        if (!string.IsNullOrEmpty(action)) query = query.Where(o => o.Action == action);
        if (from.HasValue) query = query.Where(o => o.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(o => o.CreatedAt <= to.Value);
        var logs = await query.OrderByDescending(o => o.Id).Take(10000).ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("时间,操作人,操作类型,目标类型,目标,数据,IP");
        foreach (var o in logs)
            sb.AppendLine($"{o.CreatedAt:yyyy-MM-dd HH:mm:ss},{o.UserName},{o.Action},{o.TargetType ?? ""},{o.TargetId ?? ""},{CsvField(o.Data)},{o.IpAddress ?? ""}");
        return sb.ToString();
    }

    public async Task<string> ExportCsv(string? level = null, DateTime? from = null, DateTime? to = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var query = db.SystemLogs.AsQueryable();
        if (!string.IsNullOrEmpty(level)) query = query.Where(l => l.Level == level);
        if (from.HasValue) query = query.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(l => l.CreatedAt <= to.Value);
        var logs = await query.OrderByDescending(l => l.Id).Take(10000).ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("时间,级别,分类,消息,用户");
        foreach (var l in logs)
            sb.AppendLine($"{l.CreatedAt:yyyy-MM-dd HH:mm:ss},{l.Level},{l.Category},{CsvField(l.Message)},{l.UserName ?? ""}");
        return sb.ToString();
    }

    /// <summary>
    /// 系统请求日志归档：把 CreatedAt &lt; cutoff 的行按 Id 递增分页写入 CSV（带 BOM，便于 Excel 打开中文），
    /// 返回已写入的最大 Id。调用方只应删除 Id ≤ 该值的行 —— 保证「删掉的都被归档过」。
    /// </summary>
    public async Task<LogArchive> ExportSystemLogsForArchive(DateTime cutoff, string filePath, int limit = ArchiveRowLimit)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        long lastId = 0;
        long? maxId = null;
        int written = 0;

        async IAsyncEnumerable<string> Rows()
        {
            while (written < limit)
            {
                var take = Math.Min(ArchivePageSize, limit - written);
                var batch = await db.SystemLogs.AsNoTracking()
                    .Where(l => l.CreatedAt < cutoff && l.Id > lastId)
                    .OrderBy(l => l.Id)
                    .Take(take)
                    .ToListAsync();
                if (batch.Count == 0) yield break;
                foreach (var l in batch)
                {
                    written++;
                    yield return $"{l.CreatedAt:yyyy-MM-dd HH:mm:ss},{l.Level},{l.Category},{CsvField(l.Message)},{l.UserName ?? ""}";
                }
                lastId = batch[^1].Id;
                maxId = lastId;
                if (batch.Count < take) yield break;
            }
        }

        var count = await WriteCsvAsync(filePath, "时间,级别,分类,消息,用户", Rows());
        var truncated = await db.SystemLogs.AsNoTracking().AnyAsync(l => l.CreatedAt < cutoff && l.Id > (maxId ?? long.MaxValue));
        return new LogArchive(filePath, maxId, count, truncated);
    }

    /// <summary>操作日志（审计）归档：语义同 <see cref="ExportSystemLogsForArchive"/></summary>
    public async Task<LogArchive> ExportOperationsForArchive(DateTime cutoff, string filePath, int limit = ArchiveRowLimit)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        long lastId = 0;
        long? maxId = null;
        int written = 0;

        async IAsyncEnumerable<string> Rows()
        {
            while (written < limit)
            {
                var take = Math.Min(ArchivePageSize, limit - written);
                var batch = await db.OperationLogs.AsNoTracking()
                    .Where(o => o.CreatedAt < cutoff && o.Id > lastId)
                    .OrderBy(o => o.Id)
                    .Take(take)
                    .ToListAsync();
                if (batch.Count == 0) yield break;
                foreach (var o in batch)
                {
                    written++;
                    yield return $"{o.CreatedAt:yyyy-MM-dd HH:mm:ss},{o.UserName},{o.Action},{o.TargetType ?? ""},{o.TargetId ?? ""},{CsvField(o.Data)},{o.IpAddress ?? ""}";
                }
                lastId = batch[^1].Id;
                maxId = lastId;
                if (batch.Count < take) yield break;
            }
        }

        var count = await WriteCsvAsync(filePath, "时间,操作人,操作类型,目标类型,目标,数据,IP", Rows());
        var truncated = await db.OperationLogs.AsNoTracking().AnyAsync(o => o.CreatedAt < cutoff && o.Id > (maxId ?? long.MaxValue));
        return new LogArchive(filePath, maxId, count, truncated);
    }

    private static async Task<int> WriteCsvAsync(string filePath, string header, IAsyncEnumerable<string> rows)
    {
        var dir = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var count = 0;
        await using (var writer = new StreamWriter(filePath, false, new System.Text.UTF8Encoding(true)))
        {
            await writer.WriteLineAsync(header);
            await foreach (var line in rows)
            {
                await writer.WriteLineAsync(line);
                count++;
            }
        }
        // 无超期行时不留下只有表头的空文件
        if (count == 0) File.Delete(filePath);
        return count;
    }
}
