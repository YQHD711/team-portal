namespace TeamPortal.Services;

/// <summary>
/// 标签模板的服务端契约（task-17 冻结）。GET 返回这个形状；POST/PUT 也用同一形状作请求体
/// （`id`/`updatedAt` 由服务端填，请求里给了也会被忽略）。
/// </summary>
public class LabelTemplateDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsDefault { get; set; }
    /// <summary>标签用途分类：material（缺省）/ location。不传 = material（老调用方兼容）。</summary>
    public string? Kind { get; set; }
    public double WidthMm { get; set; } = 80;
    public double HeightMm { get; set; } = 50;
    public int Dpi { get; set; } = 600;
    public string Background { get; set; } = "#FFFFFF";
    public List<LabelElementDto> Elements { get; set; } = [];
    public DateTime UpdatedAt { get; set; }
}

/// <summary>模板里的一个元素（mm 坐标、相对标签左上角）。后端只校验与存取，不参与渲染。</summary>
public class LabelElementDto
{
    public string Id { get; set; } = "";
    /// <summary>qr / text。</summary>
    public string Type { get; set; } = "text";
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
    /// <summary>text 专用：7 个动态字段之一（code/name/grade/locationCode/category/url/meta）；为空则用 <see cref="Text"/>。</summary>
    public string? Field { get; set; }
    /// <summary>text 专用：field 为空时的字面量。</summary>
    public string? Text { get; set; }
    public double FontSizePt { get; set; } = 12;
    public int FontWeight { get; set; } = 400;
    /// <summary>sans / mono。</summary>
    public string FontFamily { get; set; } = "sans";
    public string? Color { get; set; }
    /// <summary>left / center / right。</summary>
    public string Align { get; set; } = "center";
    public bool AutoShrink { get; set; } = true;
    /// <summary>qr 专用：静区宽度（mm）。</summary>
    public double? QuietMm { get; set; }
}
