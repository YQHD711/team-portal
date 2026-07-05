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

                var aiKey = config.GetValue<string>("AiService:DeepSeekKey") ?? "";
                var aiUrl = config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
                using var aiClient = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
                await conv.AddMessage(sessionId, username, "user", req.Task, aiClient, aiKey, aiUrl);

                var result = await svc.RunAgent(req.Task, username, historyTuples);

                if (!string.IsNullOrWhiteSpace(result))
                    await conv.AddMessage(sessionId, username, "assistant", result, aiClient, aiKey, aiUrl);

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
        agent.MapPost("/rebuild", async (IWebHostEnvironment env) =>
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
                // Signal restart — frontend will poll for reconnect
                _ = Task.Run(async () =>
                {
                    await Task.Delay(500);
                    Environment.Exit(0);
                });
                return Results.Ok(new { success = true, message = "编译成功，服务将在3秒后重启...", output = output[^500..] });
            }
            else
            {
                return Results.Ok(new { success = false, message = "编译失败", errors = errors[..Math.Min(2000, errors.Length)] });
            }
        });

        // ── Proposal lifecycle ──
        // States: pending → (approve) → approved → (auto-apply) → applied / failed
        //         pending → (reject) → rejected → (retry) → pending
        //         applied → (revert) → reverted (restores .bak)

        // List proposals
        agent.MapGet("/proposals", async (AppDbContext db) =>
        {
            var proposals = db.CodeProposals.OrderByDescending(p => p.CreatedAt).Take(20).ToList();
            return Results.Ok(proposals);
        });

        // Get single proposal with diff preview
        agent.MapGet("/proposals/{id}", async (string id, AppDbContext db) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            // Compute what the diff would look like
            string? currentCode = null;
            if (!string.IsNullOrEmpty(p.FilePath))
            {
                var projRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", ".."));
                var fullPath = Path.GetFullPath(Path.Combine(projRoot, p.FilePath));
                if (fullPath.StartsWith(projRoot) && File.Exists(fullPath))
                    currentCode = await File.ReadAllTextAsync(fullPath);
            }
            return Results.Ok(new { p.Id, p.Title, p.Description, p.FilePath, p.Status, p.SuggestedCode, p.OriginalCode, p.ErrorMessage, currentCode, p.CreatedAt, p.ReviewedBy });
        });

        // Approve + auto-apply
        agent.MapPost("/proposals/{id}/approve", async (string id, ClaimsPrincipal user, AppDbContext db, LogService log, IWebHostEnvironment env) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            if (p.Status != "pending" && p.Status != "failed")
                return Results.Problem($"Cannot approve proposal in '{p.Status}' state", statusCode: 400);

            p.Status = "approved";
            p.ReviewedBy = user.FindFirstValue(ClaimTypes.Name);
            p.ErrorMessage = null;
            log.Info("admin", $"Proposal approved: {p.Title}");

            // Auto-apply if code is provided
            if (!string.IsNullOrEmpty(p.FilePath) && !string.IsNullOrEmpty(p.SuggestedCode))
            {
                try
                {
                    var projRoot = Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", ".."));
                    var fullPath = Path.GetFullPath(Path.Combine(projRoot, p.FilePath));
                    log.Info("admin", $"Applying: {fullPath}");

                    if (!fullPath.StartsWith(projRoot + Path.DirectorySeparatorChar) &&
                        !fullPath.StartsWith(projRoot + "/") &&
                        fullPath != projRoot)
                    {
                        p.Status = "failed";
                        p.ErrorMessage = "路径安全校验不通过";
                    }
                    else
                    {
                        // Atomic write: write to .tmp first, then move
                        var tmpPath = fullPath + ".tmp";
                        var dir = Path.GetDirectoryName(fullPath);
                        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                            Directory.CreateDirectory(dir);

                        // Backup original
                        if (File.Exists(fullPath))
                        {
                            p.OriginalCode = await File.ReadAllTextAsync(fullPath);
                            await File.WriteAllTextAsync(fullPath + ".bak", p.OriginalCode);
                        }

                        // Write new code atomically
                        await File.WriteAllTextAsync(tmpPath, p.SuggestedCode);
                        File.Move(tmpPath, fullPath, overwrite: true);

                        p.Status = "applied";
                        log.Info("admin", $"Proposal applied: {p.Title} → {p.FilePath}");
                    }
                }
                catch (Exception ex)
                {
                    p.Status = "failed";
                    p.ErrorMessage = ex.Message;
                    log.Error("admin", $"Proposal apply failed: {ex.Message}");
                }
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { p.Status, p.ErrorMessage });
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
