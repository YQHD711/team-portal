namespace TeamPortal.Data.Models;

/// <summary>
/// 标签导出的版式模板（task-17）：**管理员维护、全队共用**（与系统设置同级的打印规范）。
///
/// <see cref="ElementsJson"/> 原样存契约里的 elements 数组（位置/字号/颜色/字段都在里面），
/// 后端不理解渲染细节，只做校验与存取；渲染在前端（原先是 web/lib/labelPdf.ts 里写死的常量）。
/// </summary>
public class LabelTemplate
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>全队唯一的默认模板（库里至少有一个模板时，必须恰好有一个为 true）。</summary>
    public bool IsDefault { get; set; }
    public double WidthMm { get; set; }
    public double HeightMm { get; set; }
    /// <summary>203 / 300 / 600。</summary>
    public int Dpi { get; set; }
    /// <summary>#RRGGBB。</summary>
    public string Background { get; set; } = "#FFFFFF";
    /// <summary>elements 数组的 JSON 原文。</summary>
    public string ElementsJson { get; set; } = "[]";
    public string? UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
