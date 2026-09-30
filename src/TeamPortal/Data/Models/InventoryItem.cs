namespace TeamPortal.Data.Models;

public class InventoryItem
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>
    /// 物料编码（《物料管理规范》§6.2 五段式：前缀-物品号-型号-采购年份-4位序号，全大写）。
    /// 留空表示"尚未贴标"，允许为空；一旦填写就必须全队唯一（系统会查重）。
    /// </summary>
    public string? Code { get; set; }
    public string Category { get; set; } = string.Empty;
    public int Quantity { get; set; }
    /// <summary>库位编码（房间-元素-层-位）。允许留空：新增的物料可以之后再归位。</summary>
    public string? LocationCode { get; set; }
    public string Status { get; set; } = "available";
    public string Grade { get; set; } = "C";
    public decimal UnitPrice { get; set; }
    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public string? PhotoUrl { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
