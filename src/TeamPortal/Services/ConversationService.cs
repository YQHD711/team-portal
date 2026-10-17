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
public partial class ConversationService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ConversationService> _log;
    private const int MaxRecentMessages = 30;
    private const int CompressThreshold = 45;

    public ConversationService(IServiceScopeFactory scopeFactory, ILogger<ConversationService> log)
    {
        _scopeFactory = scopeFactory;
        _log = log;
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
            // 配置来源统一走 AiClient.ResolveAsync()（= 系统设置 AI:*）。
            // 之前这里读的是**旧键 `AiService:*`** 且写死 model：用户在系统设置里换端点/模型
            // 对历史压缩完全无效；换第三方 OpenAI 兼容服务后请求 404 又被 catch 静默吞掉，
            // 表现为"记忆不压缩"且无从排查。2026-10 修复。
            var ai = scope.ServiceProvider.GetRequiredService<AiClient>();
            await CompressMemory(db, sessionId, ai);
        }
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