using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>LogService — 业务操作审计写入(脱敏 + 长度截断)。</summary>
public partial class LogService
{
    private const int DefaultAuditDataMaxLen = 2000;

    private const int MaxAuditJsonDepth = 256; // 序列化/解析/写回三处都要放宽(默认上限 64)

    private static readonly JsonSerializerOptions AuditJsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        MaxDepth = MaxAuditJsonDepth
    };

    /// <summary>JsonNode 写回文本用的选项:仅放宽深度,保持原有 null 保留语义。</summary>
    private static readonly JsonSerializerOptions AuditNodeWriterOptions = new() { MaxDepth = MaxAuditJsonDepth };

    private static readonly string[] SensitiveKeyHints = { "password", "passhash", "token", "secret", "apikey", "accesskey" };

    /// <summary>上次解析到的 data 上限;只读缓存刷新,避免在请求线程上同步等 DB。</summary>
    private int _auditDataMaxLen = DefaultAuditDataMaxLen;

    /// <summary>
    /// 记录一条业务操作日志。写入前:文本字段设长度上限、data 递归脱敏并截断到可配上限。
    /// 失败场景同样调用 Audit,在 data 中携带 {"success":false,"error":"..."}。
    /// 审计自身的异常一律吞掉并记录,不得影响业务流程。
    /// </summary>
    public void Audit(string action, string userName, string? targetType = null, string? targetId = null,
        object? data = null, string? ipAddress = null, int? userId = null)
    {
        try
        {
            var entry = new OperationLog
            {
                UserId = userId,
                UserName = Cap(userName, 64),
                Action = Cap(action, 32),
                TargetType = Cap(targetType, 32),
                TargetId = Cap(targetId, 64),
                Data = data is null ? null : SerializeAndScrub(data, AuditDataMaxLen()),
                IpAddress = ipAddress,
                CreatedAt = DateTime.UtcNow
            };
            if (!_auditChannel.Writer.TryWrite(entry)) Interlocked.Increment(ref _auditDropped);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LogService.Audit failed: {Action}", action);
        }
    }

    private static string Cap(string? s, int max)
        => string.IsNullOrEmpty(s) ? (s ?? string.Empty) : (s.Length <= max ? s : s[..max]);

    /// <summary>
    /// 序列化 + 递归脱敏 + 按上限截断(纯函数,便于单测)。
    /// 序列化/解析/脱敏任一步失败都绝不返回原文,只落 {"_redacted":"serialize-failed"},
    /// 否则深层结构(超出 JSON 深度上限)会绕过脱敏把敏感字段写进审计。
    /// </summary>
    internal static string SerializeAndScrub(object data, int maxLen)
    {
        string json;
        try
        {
            // 深度上限放宽到 256(默认 64):避免正常业务数据因超深而整体跳过脱敏
            var node = JsonNode.Parse(JsonSerializer.Serialize(data, AuditJsonOptions), null,
                new JsonDocumentOptions { MaxDepth = MaxAuditJsonDepth });
            ScrubNode(node);
            json = node?.ToJsonString(AuditNodeWriterOptions) ?? "{}";
        }
        catch
        {
            return "{\"_redacted\":\"serialize-failed\"}";
        }

        var cap = Math.Max(1, maxLen); // 配置成 0/负数时不得抛异常打断调用方
        return json.Length <= cap ? json : json[..cap] + "…[truncated]";
    }

    private static void ScrubNode(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            foreach (var kv in obj.ToList())
            {
                // 用 "***" 占位而非删键:保留原结构,避免下游按字段解析时错位
                if (IsSensitiveKey(kv.Key)) obj[kv.Key] = "***";
                else ScrubNode(kv.Value);
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var it in arr) ScrubNode(it);
        }
    }

    /// <summary>键名归一(仅保留字母数字并小写)后匹配,使 api_key / refreshToken 等写法也能命中。</summary>
    private static bool IsSensitiveKey(string key)
    {
        var normalized = new string(key.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        return normalized.Length > 0 && SensitiveKeyHints.Any(normalized.Contains);
    }

    /// <summary>
    /// data 长度上限:只读 SettingsService 内存缓存(启动时 SeedDefaults 已预热,设置页保存即刷新)。
    /// 未命中时沿用上次值/默认值 —— 不查库,避免同步阻塞请求线程(线程池饥饿)。
    /// </summary>
    private int AuditDataMaxLen()
    {
        if (_settings?.TryGetCachedInt("System:AuditDataMaxLen", out var v) == true && v > 0)
            _auditDataMaxLen = v;
        return _auditDataMaxLen;
    }
}
