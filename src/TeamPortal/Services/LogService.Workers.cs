using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>LogService — channel 后台消费者:批量落库(每 3 秒或满 50 条 flush 一次)。</summary>
public partial class LogService
{
    /// <summary>Background consumer — writes logs to DB every 3 seconds.</summary>
    private async Task ProcessChannel(CancellationToken ct)
    {
        var batch = new List<SystemLog>(50);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                batch.Clear();
                // Drain up to 50 items with a 3-second flush timeout
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

                try
                {
                    while (batch.Count < 50)
                    {
                        var entry = await _channel.Reader.ReadAsync(linkedCts.Token);
                        batch.Add(entry);
                    }
                }
                catch (OperationCanceledException) { /* timeout — flush what we have */ }
            }
            catch (OperationCanceledException) { break; }

            if (batch.Count == 0) continue;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.SystemLogs.AddRange(batch);
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                foreach (var entry in batch)
                    _logger.LogError("[DB-LOG-FAIL] [{Cat}] {Msg}", entry.Category, entry.Message);
                _logger.LogError(ex, "LogService batch write failed");
            }
        }
    }

    /// <summary>Background consumer — writes audit logs to DB every 3 seconds.</summary>
    private async Task ProcessAuditChannel(CancellationToken ct)
    {
        var batch = new List<OperationLog>(50);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                batch.Clear();
                // Drain up to 50 items with a 3-second flush timeout
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

                try
                {
                    while (batch.Count < 50)
                    {
                        var entry = await _auditChannel.Reader.ReadAsync(linkedCts.Token);
                        batch.Add(entry);
                    }
                }
                catch (OperationCanceledException) { /* timeout — flush what we have */ }
            }
            catch (OperationCanceledException) { break; }

            if (batch.Count == 0) continue;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.OperationLogs.AddRange(batch);
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "LogService audit batch write failed ({Count} entries)", batch.Count);
            }
        }
    }
}
