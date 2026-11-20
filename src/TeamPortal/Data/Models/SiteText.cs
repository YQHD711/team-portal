namespace TeamPortal.Data.Models;

/// <summary>
/// 界面文案的管理员覆盖值（Key 与前端 web/lib/copy/catalog.ts 一致）。
///
/// 为什么独立建表而不是塞进 SystemSetting：
/// 文案量级大（几十到几百条）、要按分组展示与导出导入、还要和代码默认值逐条对比；
/// 混进系统设置会让"重置文案"和"重置配置"互相干扰。
///
/// 表里没有的行 = 使用代码默认值，所以"重置为默认"就是删掉这一行。
/// </summary>
public class SiteText
{
    /// <summary>文案 key，例如 nav.inventory（主键）</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>管理员设置的文案；空串也按"已覆盖"处理（允许故意留空隐藏）</summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>分组（导航/顶栏/通用/登录注册/空状态…），用于管理页归类</summary>
    public string Group { get; set; } = string.Empty;

    public int? UpdatedByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
