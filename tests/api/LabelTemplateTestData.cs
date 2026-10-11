using TeamPortal.Services;

namespace api;

/// <summary>task-17 各测试共用的模板构造器（保持每个测试文件都在 200 行内）。</summary>
internal static class LabelTemplateTestData
{
    internal static LabelElementDto El(string id, string type, double x, double y, double w, double h,
        string? field = null, double fontSizePt = 12) =>
        new() { Id = id, Type = type, X = x, Y = y, W = w, H = h, Field = field, FontSizePt = fontSizePt };

    /// <summary>合法的最小模板（80×50、600dpi、二维码 + 一行 code）。</summary>
    internal static LabelTemplateDto New(string name, bool isDefault = false) => new()
    {
        Name = name, IsDefault = isDefault, WidthMm = 80, HeightMm = 50, Dpi = 600, Background = "#FFFFFF",
        Elements = [El("qr", "qr", 3, 10, 30, 30), El("code", "text", 36, 14, 41, 6, "code")],
    };

    /// <summary>接口测试用的自定义模板（60×40、300dpi、含 meta 组合字段）。</summary>
    internal static LabelTemplateDto Sample(string name = "自定义 60×40", bool isDefault = false) => new()
    {
        Name = name, IsDefault = isDefault, WidthMm = 60, HeightMm = 40, Dpi = 300, Background = "#EEEEEE",
        Elements =
        [
            new LabelElementDto { Id = "qr", Type = "qr", X = 2, Y = 2, W = 20, H = 20, QuietMm = 2 },
            new LabelElementDto { Id = "meta", Type = "text", X = 24, Y = 4, W = 34, H = 6, Field = "meta", FontSizePt = 8 },
        ],
    };
}
