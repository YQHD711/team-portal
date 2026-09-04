using System.Security.Claims;
using System.Text;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class AiEndpoints
{
    public static void MapAiEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/ai").RequireAuthorization();

        group.MapPost("/chat", async (ChatRequest req, ClaimsPrincipal user, AiProxyService proxy, ConversationService conv, LogService log) =>
        {
            if (string.IsNullOrWhiteSpace(req.Question))
                return Results.Problem("question 不能为空", statusCode: 400);
            var userName = user.FindFirstValue(ClaimTypes.Name) ?? "anonymous";
            var sessionId = req.SessionId ?? Guid.NewGuid().ToString("N")[..12];

            // Verify session ownership — if sessionId belongs to another user, start fresh
            if (!string.IsNullOrEmpty(req.SessionId) && !await conv.IsSessionOwner(sessionId, userName))
                sessionId = Guid.NewGuid().ToString("N")[..12];

            // Load conversation history
            var history = await conv.GetContext(sessionId, userName);
            var historyTuples = history.Select(m => (m.Role, m.Content)).ToList();

            // Save user message
            await conv.AddMessage(sessionId, userName, "user", req.Question);

            // Stream AI response
            var stream = await proxy.ChatStream(req.Question, historyTuples);
            if (stream is null)
            {
                log.Warn("ai", $"Chat failed: AI service unavailable, user={userName}");
                return Results.Problem("AI service unavailable", statusCode: 503);
            }

            log.Info("ai", $"Chat: {userName} session={sessionId} q={req.Question.Length} chars");

            // Wrap stream to capture the full response for saving
            var ms = new MemoryStream();
            var captureStream = new CaptureStream(stream, async (responseText) =>
            {
                if (!string.IsNullOrWhiteSpace(responseText))
                    await conv.AddMessage(sessionId, userName, "assistant", responseText);
            });

            // Return SSE stream with sessionId header
            return Results.Stream(captureStream, "text/event-stream");
        });

        group.MapPost("/search", async (SearchRequest req, ClaimsPrincipal user, AiProxyService proxy, LogService log) =>
        {
            var userName = user.FindFirstValue(ClaimTypes.Name) ?? "anonymous";
            var result = await proxy.Search(req.Query);
            if (result is null)
            {
                log.Warn("ai", $"Search failed: AI service unavailable, user={userName}");
                return Results.Problem("Search service unavailable", statusCode: 503);
            }

            log.Info("ai", $"Search: {userName} query={req.Query}");
            return Results.Ok(result);
        });
    }
}

public record ChatRequest(string Question, string? SessionId);
public record SearchRequest(string Query);

/// <summary>
/// Stream wrapper that copies data and calls a callback with the full text when done.
/// </summary>
internal class CaptureStream : Stream
{
    private readonly Stream _inner;
    private readonly Func<string, Task> _onComplete;
    private readonly MemoryStream _buffer = new();
    private readonly CancellationTokenSource _cts = new(TimeSpan.FromMinutes(5));
    private volatile bool _disposed;

    public CaptureStream(Stream inner, Func<string, Task> onComplete)
    {
        _inner = inner;
        _onComplete = onComplete;
    }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = _inner.Read(buffer, offset, count);
        if (read > 0)
        {
            _buffer.Write(buffer, offset, read);
        }
        else
        {
            _ = FinalizeAsync();
        }
        return read;
    }

    public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct)
    {
        var read = await _inner.ReadAsync(buffer, offset, count, ct);
        if (read > 0)
        {
            _buffer.Write(buffer, offset, read);
        }
        else
        {
            await FinalizeAsync();
        }
        return read;
    }

    private async Task FinalizeAsync()
    {
        if (_disposed) return;
        try
        {
            _buffer.Position = 0;
            var reader = new StreamReader(_buffer, Encoding.UTF8);
            var fullText = await reader.ReadToEndAsync();
            // Extract content from SSE data lines
            var sb = new StringBuilder();
            foreach (var line in fullText.Split('\n'))
            {
                if (line.StartsWith("data: ") && line.Length > 6)
                {
                    var json = line[6..];
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(json);
                        var choices = doc.RootElement.GetProperty("choices");
                        if (choices.GetArrayLength() > 0)
                        {
                            var delta = choices[0].GetProperty("delta");
                            if (delta.TryGetProperty("content", out var content))
                                sb.Append(content.GetString());
                        }
                    }
                    catch { /* skip malformed chunks */ }
                }
            }
            var responseText = sb.ToString();
            if (!string.IsNullOrWhiteSpace(responseText))
                await _onComplete(responseText);
        }
        catch { /* best effort */ }
    }

    public override void Flush() => _inner.Flush();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _disposed = true;
            try { _cts.Cancel(); }
            catch (ObjectDisposedException) { /* response pipeline may dispose twice */ }
            _inner.Dispose();
            _buffer.Dispose();
            _cts.Dispose();
        }
        base.Dispose(disposing);
    }
}
