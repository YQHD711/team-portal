using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// **库位标签模板适用性**（task-40 ③b）——与前端 `web/lib/labelSuitability.ts` 的 `locationLabelSuitability` **等价**：
/// 必须有 **≥1 个 `qr` 元素** 且 **≥1 处引用 `code` 或 `locationCode` 的文本**。
///
/// ⚠️ 跨语言重复实现有漂移风险 → **共享 fixture**：两侧用同一组用例标识
/// `case:valid` / `case:missing-qr` / `case:qr-without-code-text` / `case:no-text` / `case:empty`
/// （C# 见 `tests/api/LabelTemplateKindTests.cs`，TS 见 `web/tests/label-suitability.test.ts`）。
/// **冲突时以更严格的一侧为准并同步另一侧**（当前两侧规则一致）。
///
/// 用 JSON 契约键（`type`/`field`）判定，不依赖 DTO 属性命名 —— 与前端拿到的是同一份契约。
/// </summary>
public static class LabelTemplateSuitability
{
    public const string Material = "material";
    public const string Location = "location";

    /// <summary>缺省/未知 → `material`（老模板天然兼容）。</summary>
    public static string Normalize(string? kind) =>
        string.Equals(kind?.Trim(), Location, StringComparison.OrdinalIgnoreCase) ? Location : Material;

    /// <summary>返回不可读原因列表；空 = 通过。</summary>
    public static List<string> Check(string kind, object? elements, JsonSerializerOptions? options = null)
    {
        var reasons = new List<string>();
        if (Normalize(kind) != Location) return reasons;      // 物料标签不受这条约束

        var count = 0;
        var hasQr = false;
        var pointsAtCode = false;
        string? json = elements as string;
        if (json is null)
        {
            try { json = JsonSerializer.Serialize(elements ?? Array.Empty<object>(), options ?? LabelTemplateValidation.ElementsJson); }
            catch { json = "[]"; }
        }
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    count++;
                    // 键名大小写取决于序列化选项（camelCase / PascalCase 都可能）→ 两种都接受
                    var type = el.TryGetProperty("type", out var t) ? t.GetString() : el.TryGetProperty("Type", out var t2) ? t2.GetString() : null;
                    if (type == "qr") hasQr = true;
                    var fieldProp = el.TryGetProperty("field", out var f) ? f : el.TryGetProperty("Field", out var f2) ? f2 : default;
                    if (type == "text" && fieldProp.ValueKind == JsonValueKind.String)
                    {
                        var field = fieldProp.GetString();
                        if (field is "code" or "locationCode") pointsAtCode = true;
                    }
                }
            }
        }
        catch { reasons.Add("模板元素不是合法 JSON，无法校验"); return reasons; }

        if (count == 0) { reasons.Add("模板没有任何元素（case:empty）"); return reasons; }
        if (!pointsAtCode) reasons.Add("至少需要一处显示库位编码的文本（字段选「编码」或「库位」）");
        return reasons;
    }
}
