using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// 数据库完整性自检（维修任务每日调用一次）：<c>PRAGMA integrity_check</c> + <c>PRAGMA foreign_key_check</c>。
/// 只诊断不修复 —— 发现异常由运维按日志人工处理，避免自动"修复"把可取证的数据擦掉。
/// </summary>
internal static class DbIntegrityCheck
{
    /// <summary>返回 (integrity_check 结果, foreign_key_check 违规行数)。</summary>
    internal static async Task<(string Integrity, int ForeignKeyViolations)> RunAsync(AppDbContext db)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA integrity_check";
        var integrity = (await cmd.ExecuteScalarAsync())?.ToString() ?? "unknown";
        cmd.CommandText = "PRAGMA foreign_key_check";
        var violations = 0;
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync()) violations++;
        return (integrity, violations);
    }
}
