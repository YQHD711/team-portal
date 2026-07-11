using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Persistent chat history with memory compression.
/// - Recent messages: kept in full (last 30)
/// - Older messages: auto-compressed into summaries via AI
/// - Max total context: ~60 messages (30 recent + summaries)
/// </summary>
public class ConversationService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private const int MaxRecentMessages = 30;
    private const int CompressThreshold = 45;

    public ConversationService(IServiceScopeFactory scopeFactory, IHttpClientFactory httpClientFactory, IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _httpClientFactory = httpClientFactory;
        _config = config;
    }

    /// <summary>Add a message. Auto-compresses when conversation grows too large.</summary>
    public async Task AddMessage(string sessionId, string userName, string role, string content)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        string? title = null;
        if (role == "user")
        {
            var existing = await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId);
            if (!existing)
                title = content.Length > 50 ? content[..50] + "..." : content;
        }

        db.ChatMessages.Add(new ChatMessage
        {
            SessionId = sessionId, UserName = userName, Role = role,
            Content = content, SessionTitle = title
        });
        await db.SaveChangesAsync();

        // Check if compression needed
        var nonSystemCount = await db.ChatMessages
            .CountAsync(m => m.SessionId == sessionId && m.Role != "system");

        if (nonSystemCount > CompressThreshold)
        {
            var apiKey = _config.GetValue<string>("AiService:DeepSeekKey") ?? "";
            var baseUrl = _config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
            if (!string.IsNullOrEmpty(apiKey))
            {
                await CompressMemory(db, sessionId, apiKey, baseUrl);
            }
        }
    }

    /// <summary>
    /// Compress old messages into a system-level summary.
    /// Takes oldest 15 user/assistant messages, summarizes them via AI,
    /// stores the summary as a system message, deletes originals.
    /// </summary>
    private async Task CompressMemory(AppDbContext db, string sessionId,
        string apiKey, string baseUrl)
    {
        var oldMessages = await db.ChatMessages
            .Where(m => m.SessionId == sessionId && m.Role != "system")
            .OrderBy(m => m.Id)
            .Take(15)
            .ToListAsync();

        if (oldMessages.Count < 5) return;

        // Build conversation text for summarization
        var sb = new StringBuilder();
        foreach (var m in oldMessages)
            sb.AppendLine($"[{m.Role}]: {m.Content}");

        // Ask AI to summarize
        var summaryPrompt = $"请用中文简洁总结以下对话的关键信息（不超过200字），保留重要决策、数据、用户偏好、任务进度等信息：\n\n{sb}";

        try
        {
            var payload = new
            {
                model = "deepseek-v4-flash",
                messages = new[] { new { role = "user", content = summaryPrompt } },
                temperature = 0.3, max_tokens = 500
            };
            var json = JsonSerializer.Serialize(payload);
            var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.Add("Authorization", $"Bearer {apiKey}");

            var client = _httpClientFactory.CreateClient();
            var resp = await client.SendAsync(req);
            if (resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var summary = doc.RootElement.GetProperty("choices")[0]
                    .GetProperty("message").GetProperty("content").GetString() ?? "";

                if (!string.IsNullOrWhiteSpace(summary))
                {
                    // Store summary as system message
                    db.ChatMessages.Add(new ChatMessage
                    {
                        SessionId = sessionId, UserName = "system", Role = "system",
                        Content = $"📝 历史摘要: {summary}", SessionTitle = null
                    });

                    // Delete summarized messages
                    db.ChatMessages.RemoveRange(oldMessages);
                    await db.SaveChangesAsync();
                }
            }
        }
        catch { /* compression failure is non-critical — silently continue */ }
    }

    /// <summary>Check if a user owns a session (has at least one message in it). Empty session = no owner.</summary>
    public async Task<bool> IsSessionOwner(string sessionId, string userName)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var any = await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId);
        if (!any) return true; // brand-new session, first message will claim it
        return await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId && m.UserName == userName);
    }

    /// <summary>Get context for AI — includes compressed summaries + recent messages. Verifies ownership.</summary>
    public async Task<List<ChatMessage>> GetContext(string sessionId, string? userName = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (userName is not null)
        {
            var any = await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId);
            if (any && !await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId && m.UserName == userName))
                return new List<ChatMessage>(); // not owner — return empty
        }
        return await db.ChatMessages
            .Where(m => m.SessionId == sessionId)
            .OrderBy(m => m.Id)
            .ToListAsync();
    }

    /// <summary>List sessions for a user.</summary>
    public async Task<List<object>> ListSessions(string userName)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.ChatMessages
            .Where(m => m.UserName == userName && m.Role == "user")
            .GroupBy(m => m.SessionId)
            .Select(g => new
            {
                sessionId = g.Key,
                title = g.OrderBy(m => m.Id).First().SessionTitle ?? "新对话",
                messageCount = g.Count(),
                lastMessage = g.OrderByDescending(m => m.Id).First().CreatedAt
            })
            .OrderByDescending(s => s.lastMessage)
            .Take(20)
            .ToListAsync<object>();
    }

    /// <summary>Get stats for a session.</summary>
    public async Task<object> GetSessionStats(string sessionId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var total = await db.ChatMessages.CountAsync(m => m.SessionId == sessionId);
        var summaries = await db.ChatMessages.CountAsync(m => m.SessionId == sessionId && m.Role == "system");
        var byRole = await db.ChatMessages
            .Where(m => m.SessionId == sessionId && m.Role != "system")
            .GroupBy(m => m.Role)
            .Select(g => new { role = g.Key, count = g.Count() })
            .ToListAsync();
        return new { sessionId, total, summaries, byRole };
    }

    public async Task<bool> DeleteSession(string sessionId, string? userName = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (userName is not null)
        {
            var any = await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId);
            if (any && !await db.ChatMessages.AnyAsync(m => m.SessionId == sessionId && m.UserName == userName))
                return false; // not owner
        }
        await db.ChatMessages.Where(m => m.SessionId == sessionId).ExecuteDeleteAsync();
        return true;
    }
}
