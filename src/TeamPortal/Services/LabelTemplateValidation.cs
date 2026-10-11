using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 标签模板的服务端校验与内置默认版式（task-17）。
///
/// 为什么必须服务端校验：模板是**全队共用的打印规范**，前端设计器可能被绕过/改坏；
/// 一旦写进一个超出标签边界的元素，所有队员导出的 PDF 都是坏的。所以先校验再改库，
/// **拒绝时绝不触碰已有模板**（调用方拿到非 null 的错误串就直接 400）。
///
/// `meta` 是**组合字段**（`${grade||"-"} 级 · ${locationCode||"库位未指定"} · ${category||"未分类"}`），
/// 由前端按固定规则拼接；后端只认它是合法取值、原样存取，不参与拼接。
/// </summary>
public static class LabelTemplateValidation
{
    /// <summary>7 个合法字段（task-17 勘误后定死，含组合字段 meta）。</summary>
    public static readonly string[] Fields =
        ["code", "name", "grade", "locationCode", "category", "url", "meta"];

    public static readonly int[] Dpis = [203, 300, 600];
    public const int MaxElements = 50;
    private const double Eps = 0.001;
    private static readonly Regex HexColor = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);

    /// <summary>返回 null = 合法；否则是可读的拒绝原因。</summary>
    public static string? Validate(LabelTemplateDto req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) return "name 不能为空";
        if (req.Name.Trim().Length > 100) return "name 最长 100 字";
        if (req.WidthMm < 10 || req.WidthMm > 300) return "widthMm 必须在 10..300 之间";
        if (req.HeightMm < 10 || req.HeightMm > 300) return "heightMm 必须在 10..300 之间";
        if (!Dpis.Contains(req.Dpi)) return "dpi 只能是 203 / 300 / 600";
        if (!HexColor.IsMatch(req.Background ?? "")) return "background 必须是 #RRGGBB";

        var elements = req.Elements ?? [];
        if (elements.Count > MaxElements) return $"elements 最多 {MaxElements} 个";

        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < elements.Count; i++)
        {
            var e = elements[i];
            var at = $"elements[{i}]";
            if (string.IsNullOrWhiteSpace(e.Id)) return $"{at}.id 不能为空";
            if (!ids.Add(e.Id.Trim())) return $"{at}.id 重复：{e.Id}";
            if (e.Type is not ("qr" or "text")) return $"{at}.type 只能是 qr / text";
            if (e.X < 0 || e.Y < 0 || e.W <= 0 || e.H <= 0) return $"{at} 的 x/y ≥ 0、w/h > 0（单位 mm）";
            if (e.X + e.W > req.WidthMm + Eps) return $"{at} 超出标签右边界（x+w > widthMm）";
            if (e.Y + e.H > req.HeightMm + Eps) return $"{at} 超出标签下边界（y+h > heightMm）";

            if (e.Type == "qr")
            {
                if (!string.IsNullOrWhiteSpace(e.Field)) return $"{at} 是二维码，不能带 field";
                if (e.QuietMm is { } q && (q < 0 || q >= Math.Min(e.W, e.H) / 2))
                    return $"{at}.quietMm 必须 ≥ 0 且 < min(w,h)/2";
                continue;
            }

            if (!string.IsNullOrWhiteSpace(e.Field) && !Fields.Contains(e.Field.Trim()))
                return $"{at}.field 不在允许的 7 个字段内（{string.Join(" / ", Fields)}）";
            if (e.FontSizePt < 4 || e.FontSizePt > 72) return $"{at}.fontSizePt 必须在 4..72 之间";
            if (e.FontWeight < 100 || e.FontWeight > 900) return $"{at}.fontWeight 必须在 100..900 之间";
            if (e.FontFamily is not ("sans" or "mono")) return $"{at}.fontFamily 只能是 sans / mono";
            if (!string.IsNullOrWhiteSpace(e.Color) && !HexColor.IsMatch(e.Color))
                return $"{at}.color 必须是 #RRGGBB";
            if (e.Align is not ("left" or "center" or "right")) return $"{at}.align 只能是 left / center / right";
        }
        return null;
    }

    /// <summary>
    /// 内置默认模板：**逐字等价于改造前写死的 80×50 版式**，也与前端 `labelTemplate.ts` 的
    /// `DEFAULT_TEMPLATE` 一致（元素 id 都用 qr/code/name/meta/url，方便两边对照）。
    /// </summary>
    public static LabelTemplateDto BuiltInDefault() => new()
    {
        Name = "默认 80×50",
        IsDefault = true,
        WidthMm = 80,
        HeightMm = 50,
        Dpi = 600,
        Background = "#FFFFFF",
        Elements =
        [
            new() { Id = "qr", Type = "qr", X = 3, Y = 10, W = 30, H = 30, QuietMm = 3 },
            new() { Id = "code", Type = "text", X = 36, Y = 14, W = 41, H = 6, Field = "code",
                FontSizePt = 12, FontWeight = 700, FontFamily = "mono", Color = "#111111", Align = "center", AutoShrink = true },
            new() { Id = "name", Type = "text", X = 36, Y = 22, W = 41, H = 7, Field = "name",
                FontSizePt = 10, FontWeight = 600, FontFamily = "sans", Color = "#111111", Align = "center", AutoShrink = true },
            new() { Id = "meta", Type = "text", X = 36, Y = 29.5, W = 41, H = 5, Field = "meta",
                FontSizePt = 8, FontWeight = 400, FontFamily = "sans", Color = "#444444", Align = "center", AutoShrink = true },
            new() { Id = "url", Type = "text", X = 36, Y = 35.5, W = 41, H = 4.5, Field = "url",
                FontSizePt = 6.5, FontWeight = 400, FontFamily = "sans", Color = "#666666", Align = "center", AutoShrink = true },
        ],
    };

    /// <summary>存 elements 用：不写 null 字段、中文不转义（转义会让 JSON 体积涨 6 倍且难读）。</summary>
    internal static readonly JsonSerializerOptions ElementsJson = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
