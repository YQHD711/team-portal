using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>LogService — 业务操作审计写入(脱敏 + 长度截断)。</summary>
public partial class LogService
{
    private static readonly JsonSerializerOptions AuditJsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly string[] SensitiveKeyHints = { "password", "passhash", "token", "secret", "apikey", "accesskey", "refresh_token", "refreshtoken" };

    /// <summary>
    /// 记录一条业务操作日志。写入前:文本字段设长度上限、data 递归剥敏感键并截断到可配上限。
    /// 失败场景同样调用 Audit,在 data 中携带 {"success":false,"error":"..."}。
    /// </summary>
    public void Audit(string action, string userName, string? targetType = null, string? targetId = null,
        object? data = null, string? ipAddress = null, int? userId = null)
    {
        var entry = new OperationLog
        {
            UserId = userId,
            UserName = Cap(userName, 64),
            Action = Cap(action, 32),
            TargetType = Cap(targetType, 32),
            TargetId = Cap(targetId, 64),
            Data = data is null ? null : ScrubAndCap(data),
            IpAddress = ipAddress,
            CreatedAt = DateTime.UtcNow
        };
        if (!_auditChannel.Writer.TryWrite(entry)) Interlocked.Increment(ref _auditDropped);
    }

    private static string Cap(string? s, int max)
        => string.IsNullOrEmpty(s) ? (s ?? string.Empty) : (s.Length <= max ? s : s[..max]);

    /// <summary>脱敏(递归剥敏感键) + 截断到可配长度上限</summary>
    private string ScrubAndCap(object data)
    {
        var json = JsonSerializer.Serialize(data, AuditJsonOptions);
        try
        {
            var node = JsonNode.Parse(json);
            ScrubNode(node);
            json = node?.ToJsonString() ?? "{}";
        }
        catch { /* 解析失败保留原文,仅做长度截断 */ }
        var maxLen = AuditDataMaxLen();
        return json.Length <= maxLen ? json : json[..maxLen] + "…[truncated]";
    }

    private static void ScrubNode(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            foreach (var kv in obj.ToList())
            {
                if (SensitiveKeyHints.Any(h => kv.Key.Contains(h, StringComparison.OrdinalIgnoreCase)))
                    obj.Remove(kv.Key);
                else ScrubNode(kv.Value);
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var it in arr) ScrubNode(it);
        }
    }

    private int AuditDataMaxLen()
    {
        try { return _settings.GetInt("System:AuditDataMaxLen", 2000).GetAwaiter().GetResult(); }
        catch { return 2000; }
    }
}
