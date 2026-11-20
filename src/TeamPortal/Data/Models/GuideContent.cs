namespace TeamPortal.Data.Models;

/// <summary>
/// 管理员覆盖的引导内容；默认值在 web/lib/tours/tours/*.ts。
///
/// 只覆盖已存在的 tour key（新增引导必须先写代码里的锚点与默认定义），
/// 后台能做的是改标题/步骤文案/顺序、启停、版本号，而不是凭空造一条引导。
/// </summary>
public class GuideContent
{
    /// <summary>引导 key，例如 battery（主键）</summary>
    public string TourKey { get; set; } = string.Empty;

    /// <summary>覆盖后的标题；为空则沿用代码默认</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>TourStep[] 的 JSON；空数组表示沿用代码默认步骤</summary>
    public string StepsJson { get; set; } = "[]";

    /// <summary>停用后前端不再自动弹出，引导中心里也不显示</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>内容版本；0 表示未声明（前端沿用代码里的 version）</summary>
    public int Version { get; set; }

    public int? UpdatedByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
