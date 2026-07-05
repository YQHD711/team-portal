namespace TeamPortal.Data.Models;

/// <summary>
/// Persistent chat message for AI conversation memory.
/// Each conversation is identified by a session ID + user.
/// </summary>
public class ChatMessage
{
    public long Id { get; set; }
    /// <summary>Conversation session ID (group messages together)</summary>
    public string SessionId { get; set; } = "";
    /// <summary>User who sent/received this message</summary>
    public string UserName { get; set; } = "";
    /// <summary>"user" or "assistant" or "system"</summary>
    public string Role { get; set; } = "";
    /// <summary>Message content</summary>
    public string Content { get; set; } = "";
    /// <summary>Summary title for the conversation list</summary>
    public string? SessionTitle { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
