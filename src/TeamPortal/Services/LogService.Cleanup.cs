using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>清理结果：两表各删除的行数</summary>
public record LogCleanupResult(int SystemDeleted, int OperationDeleted)
{
    public int Total => SystemDeleted + OperationDeleted;
}

/// <summary>一次清理的单表留痕（写入 SystemSettings 的 Audit:LastCleanup）。</summary>
public record LogCleanupEntry(
    string Table, int Count, long? MaxId, string? Sha256,
    string? ArchivePath, string? RemotePath, int Deleted);

/// <summary>一次清理的完整留痕（含操作者与是否强制）。</summary>
public record LogCleanupReceipt(DateTime AtUtc, string? Actor, bool Forced, IReadOnlyList<LogCleanupEntry> Entries);

/// <summary>
/// LogService — 保留期清理（append-only 加固，H-04）。
///
/// 不变量：**任何删除都必须先被归档覆盖**。
///  - CleanupOldLogs：只删「超期且 Id ≤ 已归档 MaxId」的行（调用方从归档结果传入）；
///  - LazyPruneOperationLogs：只删「Id ≤ 已持久化的归档水位」的行；**没有水位就一行都不删**；
///  - ClearArchivedLogs：强制清空也只删「已归档覆盖」的行，不做无归档的时间盲删。
/// 清理水位与最近一次清理回执写入 SystemSettings（Audit:*），不随日志清理删除。
/// </summary>
public partial class LogService
{
    public const string LastCleanupSettingKey = "Audit:LastCleanup";
    public const string SystemArchiveWatermarkKey = "Audit:SystemArchiveMaxId";
    public const string OperationArchiveWatermarkKey = "Audit:OperationArchiveMaxId";

    private static readonly JsonSerializerOptions CleanupJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// 按保留期清理两表：只删「已成功归档」的行（Id ≤ 对应 archivedMaxId 且已超期）。
    /// 传 null 表示该表本次未归档（或归档失败），此时**不删除**该表任何行。
    /// </summary>
    public async Task<LogCleanupResult> CleanupOldLogs(long? archivedSystemMaxId, long? archivedOperationMaxId,
        string? systemArchivePath = null, string? operationArchivePath = null, string? actor = null)
    {
        var sysDays = await _settings.GetInt("System:LogRetentionDays", 90);
        var opDays = await _settings.GetInt("System:OperationLogRetentionDays", 180);
        var now = DateTime.UtcNow;
        var sysCutoff = now.AddDays(-sysDays);
        var opCutoff = now.AddDays(-opDays);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var sysDeleted = archivedSystemMaxId.HasValue
            ? await db.SystemLogs.Where(l => l.CreatedAt < sysCutoff && l.Id <= archivedSystemMaxId.Value).ExecuteDeleteAsync()
            : 0;
        var opDeleted = archivedOperationMaxId.HasValue
            ? await db.OperationLogs.Where(o => o.CreatedAt < opCutoff && o.Id <= archivedOperationMaxId.Value).ExecuteDeleteAsync()
            : 0;

        await AdvanceWatermarkAsync(SystemArchiveWatermarkKey, archivedSystemMaxId);
        await AdvanceWatermarkAsync(OperationArchiveWatermarkKey, archivedOperationMaxId);

        var result = new LogCleanupResult(sysDeleted, opDeleted);
        if (archivedSystemMaxId.HasValue || archivedOperationMaxId.HasValue)
            await RecordCleanupAsync(BuildEntries(result, archivedSystemMaxId, archivedOperationMaxId, systemArchivePath, operationArchivePath), actor, forced: false);
        if (result.Total > 0)
            _logger.LogInformation("LogService: cleaned {Sys} sys logs >{SD}d & {Op} op logs >{OD}d", sysDeleted, sysDays, opDeleted, opDays);
        return result;
    }

    /// <summary>
    /// 低频惰性删操作日志超期行（约每 10 分钟最多一次）。
    /// 只删「Id ≤ 已归档水位」的行：没有归档水位时直接返回 0，**禁止按时间盲删**。
    /// </summary>
    public async Task<int> LazyPruneOperationLogs()
    {
        const long intervalTicks = 10 * 60 * 1000; // 10 分钟
        if (Environment.TickCount64 - _lastOpPruneTicks < intervalTicks) return 0;
        _lastOpPruneTicks = Environment.TickCount64;

        var watermark = await GetArchiveWatermarkAsync(OperationArchiveWatermarkKey);
        if (watermark is null or <= 0)
        {
            _logger.LogDebug("LogService: lazy prune skipped — no archive watermark yet");
            return 0;
        }

        var days = await _settings.GetInt("System:OperationLogRetentionDays", 180);
        var cutoff = DateTime.UtcNow.AddDays(-days);
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var deleted = await db.OperationLogs
            .Where(o => o.Id <= watermark.Value && o.CreatedAt < cutoff)
            .ExecuteDeleteAsync();
        if (deleted > 0)
            _logger.LogInformation("LogService: lazy pruned {Count} operation logs (id<={MaxId}, >{D}d)", deleted, watermark.Value, days);
        return deleted;
    }

    /// <summary>
    /// 强制清空：只删「已归档覆盖」的行（Id ≤ 传入的归档 MaxId），不按时间盲删。
    /// 归档失败时调用方不得调用本方法（null 表示该表未归档 → 一行都不删）。
    /// </summary>
    public async Task<LogCleanupResult> ClearArchivedLogs(long? archivedSystemMaxId, long? archivedOperationMaxId,
        string? systemArchivePath = null, string? operationArchivePath = null, string? actor = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var sys = archivedSystemMaxId.HasValue
            ? await db.SystemLogs.Where(l => l.Id <= archivedSystemMaxId.Value).ExecuteDeleteAsync()
            : 0;
        var op = archivedOperationMaxId.HasValue
            ? await db.OperationLogs.Where(o => o.Id <= archivedOperationMaxId.Value).ExecuteDeleteAsync()
            : 0;

        await AdvanceWatermarkAsync(SystemArchiveWatermarkKey, archivedSystemMaxId);
        await AdvanceWatermarkAsync(OperationArchiveWatermarkKey, archivedOperationMaxId);

        var result = new LogCleanupResult(sys, op);
        if (archivedSystemMaxId.HasValue || archivedOperationMaxId.HasValue)
            await RecordCleanupAsync(BuildEntries(result, archivedSystemMaxId, archivedOperationMaxId, systemArchivePath, operationArchivePath), actor, forced: true);
        if (result.Total > 0)
            _logger.LogInformation("LogService: cleared {Sys} archived sys logs & {Op} archived op logs", sys, op);
        return result;
    }

    /// <summary>读取持久化的归档水位（Id ≤ 水位 = 一定已归档）。</summary>
    public async Task<long?> GetArchiveWatermarkAsync(string key)
    {
        var raw = await _settings.Get(key, "");
        return long.TryParse(raw, out var value) ? value : null;
    }

    /// <summary>水位只前进不后退：同一批行反复归档时保持最大值。</summary>
    private async Task AdvanceWatermarkAsync(string key, long? maxId)
    {
        if (maxId is not { } id || id <= 0) return;
        var current = await GetArchiveWatermarkAsync(key);
        if (current is { } known && known >= id) return;
        await _settings.Set(key, id.ToString(), "系统参数",
            "日志归档水位：LazyPrune/强制清理只删除 Id ≤ 该值的行（不随日志清理删除）");
    }

    /// <summary>归档文件的 SHA-256（小写 hex）；文件不存在返回 null。</summary>
    public static string? Sha256OfFile(string? path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    /// <summary>把「本次清理结果 + 归档位置」组装成两表回执条目（sha256 从归档文件现算）。</summary>
    private static List<LogCleanupEntry> BuildEntries(LogCleanupResult result,
        long? systemMaxId, long? operationMaxId, string? systemArchivePath, string? operationArchivePath) =>
    [
        new("SystemLogs", result.SystemDeleted, systemMaxId, Sha256OfFile(systemArchivePath),
            systemArchivePath, null, result.SystemDeleted),
        new("OperationLogs", result.OperationDeleted, operationMaxId, Sha256OfFile(operationArchivePath),
            operationArchivePath, null, result.OperationDeleted),
    ];

    /// <summary>
    /// 把本次清理的 {count, table, maxId, sha256, archivePath, remotePath, deleted} 写入
    /// SystemSettings（Audit:LastCleanup），作为不随日志清理删除的持久留痕。
    /// </summary>
    public async Task RecordCleanupAsync(IEnumerable<LogCleanupEntry> entries, string? actor = null, bool forced = false)
    {
        var list = entries.ToList();
        var receipt = new LogCleanupReceipt(DateTime.UtcNow, actor, forced, list);
        await _settings.Set(LastCleanupSettingKey, JsonSerializer.Serialize(receipt, CleanupJsonOptions),
            "系统参数", "最近一次日志清理回执（count/table/maxId/sha256；不随日志清理删除）");

        foreach (var entry in list)
        {
            var key = entry.Table switch
            {
                nameof(AppDbContext.SystemLogs) => SystemArchiveWatermarkKey,
                nameof(AppDbContext.OperationLogs) => OperationArchiveWatermarkKey,
                _ => null,
            };
            if (key is not null) await AdvanceWatermarkAsync(key, entry.MaxId);
        }
    }
}
