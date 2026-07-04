using System.Security.Claims;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class SystemAgentEndpoints
{
    public static void MapSystemAgentEndpoints(this WebApplication app)
    {
        var agent = app.MapGroup("/api/admin/agent").RequireAuthorization();

        // Run AI analysis
        agent.MapPost("/analyze", async (AgentRequest req, ClaimsPrincipal user, SystemAgentService svc) =>
        {
            var username = user.FindFirstValue(ClaimTypes.Name) ?? "admin";
            var result = await svc.RunAgent(req.Task, username);
            return Results.Ok(new { result });
        });

        // List proposals
        agent.MapGet("/proposals", async (AppDbContext db) =>
        {
            var proposals = db.CodeProposals.OrderByDescending(p => p.CreatedAt).Take(20).ToList();
            return Results.Ok(proposals);
        });

        // Approve proposal
        agent.MapPost("/proposals/{id}/approve", async (string id, ClaimsPrincipal user, AppDbContext db, LogService log) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            p.Status = "approved";
            p.ReviewedBy = user.FindFirstValue(ClaimTypes.Name);
            log.Info("admin", $"Code proposal approved: {p.Title}");

            // Apply the change if file and code are provided
            if (!string.IsNullOrEmpty(p.FilePath) && !string.IsNullOrEmpty(p.SuggestedCode))
            {
                try
                {
                    var projRoot = Path.Combine(Directory.GetCurrentDirectory(), "..", "..");
                    var fullPath = Path.GetFullPath(Path.Combine(projRoot, p.FilePath));
                    if (fullPath.StartsWith(projRoot))
                    {
                        // Backup original
                        if (File.Exists(fullPath))
                        {
                            p.OriginalCode = await File.ReadAllTextAsync(fullPath);
                            File.WriteAllText(fullPath + ".bak", p.OriginalCode);
                        }
                        await File.WriteAllTextAsync(fullPath, p.SuggestedCode);
                        p.Status = "applied";
                        log.Info("admin", $"Code proposal applied: {p.Title} → {p.FilePath}");
                    }
                }
                catch (Exception ex) { log.Error("admin", $"Failed to apply proposal: {ex.Message}"); }
            }

            await db.SaveChangesAsync();
            return Results.Ok(new { p.Status });
        });

        // Reject proposal
        agent.MapPost("/proposals/{id}/reject", async (string id, ClaimsPrincipal user, AppDbContext db, LogService log) =>
        {
            var p = await db.CodeProposals.FindAsync(id);
            if (p is null) return Results.Problem("Not found", statusCode: 404);
            p.Status = "rejected";
            p.ReviewedBy = user.FindFirstValue(ClaimTypes.Name);
            log.Info("admin", $"Code proposal rejected: {p.Title}");
            await db.SaveChangesAsync();
            return Results.Ok(new { p.Status });
        });
    }
}

public record AgentRequest(string Task);
