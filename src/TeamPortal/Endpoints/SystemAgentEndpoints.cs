using System.Security.Claims;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class SystemAgentEndpoints
{
    private static readonly SemaphoreSlim _agentLock = new(1, 1);
    private static volatile bool _agentBusy = false;

    public static void MapSystemAgentEndpoints(this WebApplication app)
    {
        var agent = app.MapGroup("/api/admin/agent").RequireAuthorization("AdminOnly");

        // Run AI analysis — single-threaded to prevent concurrent tool execution conflicts
        agent.MapPost("/analyze", async (AgentRequest req, ClaimsPrincipal user, SystemAgentService svc, ConversationService conv, IConfiguration config) =>
        {
            if (_agentBusy)
                return Results.Problem("AI 管理员正在处理上一个任务，请等待完成后重试", statusCode: 429);

            if (!await _agentLock.WaitAsync(0))
                return Results.Problem("AI 管理员正忙", statusCode: 429);

            _agentBusy = true;
            try
            {
                var username = user.FindFirstValue(ClaimTypes.Name) ?? "admin";
                const string sessionId = "admin-agent";

                var history = await conv.GetContext(sessionId);
                var historyTuples = history.Select(m => (m.Role, m.Content)).ToList();

                await conv.AddMessage(sessionId, username, "user", req.Task);

                var result = await svc.RunAgent(req.Task, username, historyTuples);

                if (!string.IsNullOrWhiteSpace(result))
                    await conv.AddMessage(sessionId, username, "assistant", result);

                var stats = await conv.GetSessionStats(sessionId);
                return Results.Ok(new { result, sessionId, stats });
            }
            finally
            {
                _agentBusy = false;
                _agentLock.Release();
            }
        });

        // Check agent status
        agent.MapGet("/status", () => Results.Ok(new { busy = _agentBusy }));

        // Get AI Admin memory stats
        agent.MapGet("/memory", async (ConversationService conv) =>
        {
            var stats = await conv.GetSessionStats("admin-agent");
            return Results.Ok(stats);
        });

        // Clear AI Admin memory
        agent.MapPost("/memory/clear", async (ConversationService conv) =>
        {
            await conv.DeleteSession("admin-agent");
            return Results.Ok(new { success = true });
        });

        // Build & restart (applies all pending proposals)
        agent.MapPost("/rebuild", async (IWebHostEnvironment env, IHostApplicationLifetime lifetime) =>
        {
            var projRoot = Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", ".."));
            var psi = new System.Diagnostics.ProcessStartInfo("dotnet", "build src/TeamPortal/")
            {
                WorkingDirectory = projRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            var proc = System.Diagnostics.Process.Start(psi);
            if (proc is null) return Results.Problem("无法启动编译", statusCode: 500);
            await proc.WaitForExitAsync();
            var output = await proc.StandardOutput.ReadToEndAsync();
            var errors = await proc.StandardError.ReadToEndAsync();

            if (proc.ExitCode == 0)
            {
                _ = Task.Run(async () => { await Task.Delay(500); lifetime.StopApplication(); });
                return Results.Ok(new { success = true, message = "编译成功，服务将在3秒后重启...", output = output[^500..] });
            }
            else
            {
                return Results.Ok(new { success = false, message = "编译失败", errors = errors[..Math.Min(2000, errors.Length)] });
            }
        });

        // ── Proposal lifecycle ──
        // States: pending → (approve) → approved → (maintenance apply) → applied / failed
        //         pending → (reject) → rejected → (retry) → pending
        //         applied → (revert) → reverted

        // List proposals
        agent.MapGet("/proposals", async (AppDbContext db) =>
        {
            var proposals = db.CodeProposals.OrderByDescending(p => p.CreatedAt).Take(20).ToList();
            return Results.Ok(proposals);
        });

        // Get single proposal
        agent.MapGet("/proposals/{id}", async (string id, AppDbContext db) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            string? currentCode = null;
            if (!string.IsNullOrEmpty(p.FilePath))
            {
                var projRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", ".."));
                var fullPath = Path.GetFullPath(Path.Combine(projRoot, p.FilePath));
                if (fullPath.StartsWith(projRoot) && File.Exists(fullPath))
                    currentCode = await File.ReadAllTextAsync(fullPath);
            }
            return Results.Ok(new { p.Id, p.Title, p.Description, p.FilePath, p.Status, p.SuggestedCode, p.OriginalCode, p.ErrorMessage, currentCode, p.CreatedAt });
        });

        // Approve — just marks status, actual apply is via maintenance panel
        agent.MapPost("/proposals/{id}/approve", async (string id, ClaimsPrincipal user, AppDbContext db, LogService log) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            if (p.Status != "pending" && p.Status != "failed")
                return Results.Problem($"Cannot approve in '{p.Status}' state", statusCode: 400);

            p.Status = "approved";
            p.ReviewedBy = user.FindFirstValue(ClaimTypes.Name);
            p.ErrorMessage = null;
            await db.SaveChangesAsync();
            log.Info("admin", $"Proposal approved: {p.Title} (apply via maintenance panel)");
            return Results.Ok(new { p.Status });
        });

        // Reject proposal
        agent.MapPost("/proposals/{id}/reject", async (string id, ClaimsPrincipal user, AppDbContext db, LogService log) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            p.Status = "rejected";
            p.ReviewedBy = user.FindFirstValue(ClaimTypes.Name);
            log.Info("admin", $"Proposal rejected: {p.Title}");
            await db.SaveChangesAsync();
            return Results.Ok(new { p.Status });
        });

        // Retry — move rejected/failed back to pending
        agent.MapPost("/proposals/{id}/retry", async (string id, AppDbContext db, LogService log) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            if (p.Status != "rejected" && p.Status != "failed")
                return Results.Problem($"Cannot retry proposal in '{p.Status}' state", statusCode: 400);
            p.Status = "pending";
            p.ErrorMessage = null;
            log.Info("admin", $"Proposal retried: {p.Title}");
            await db.SaveChangesAsync();
            return Results.Ok(new { p.Status });
        });

        // Revert — restore .bak file
        agent.MapPost("/proposals/{id}/revert", async (string id, AppDbContext db, LogService log, IWebHostEnvironment env) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            if (p.Status != "applied")
                return Results.Problem($"Cannot revert proposal in '{p.Status}' state", statusCode: 400);

            try
            {
                var projRoot = Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", ".."));
                var fullPath = Path.GetFullPath(Path.Combine(projRoot, p.FilePath));
                var bakPath = fullPath + ".bak";

                if (File.Exists(bakPath))
                {
                    File.Move(bakPath, fullPath, overwrite: true);
                    p.Status = "reverted";
                    log.Info("admin", $"Proposal reverted: {p.Title} — restored from .bak");
                }
                else if (!string.IsNullOrEmpty(p.OriginalCode))
                {
                    await File.WriteAllTextAsync(fullPath, p.OriginalCode);
                    p.Status = "reverted";
                    log.Info("admin", $"Proposal reverted: {p.Title} — restored from OriginalCode");
                }
                else
                {
                    p.ErrorMessage = "备份文件不存在，无法回滚";
                    return Results.Problem(p.ErrorMessage, statusCode: 400);
                }
            }
            catch (Exception ex)
            {
                p.ErrorMessage = $"回滚失败: {ex.Message}";
                log.Error("admin", $"Proposal revert failed: {ex.Message}");
                return Results.Problem(p.ErrorMessage, statusCode: 500);
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { p.Status });
        });
    }
}

public record AgentRequest(
    [property: System.Text.Json.Serialization.JsonPropertyName("task")] string Task,
    [property: System.Text.Json.Serialization.JsonPropertyName("sessionId")] string? SessionId
);
