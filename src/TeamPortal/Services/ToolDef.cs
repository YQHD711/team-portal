using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// DeepSeek function calling 的工具声明。
/// 原先内嵌在 WikiGeneratorService.cs 末尾，现由「Wiki 生成」与「AI 运维助手」共用，独立成文件。
/// </summary>
public class ToolDef
{
    public string Name { get; set; }
    public string Description { get; set; }
    public object Parameters { get; set; }

    /// <summary>所有参数都必填（历史行为，Wiki 生成的工具均无可选参数）。</summary>
    public ToolDef(string name, string desc, object properties)
        : this(name, desc, properties, null)
    {
    }

    /// <summary>
    /// 显式声明必填参数。传 null 表示「全部必填」；传数组则只有数组内的参数必填，
    /// 其余在 JSON Schema 里只出现在 properties 中 —— 可选参数若被误标为 required，
    /// 模型每次都必须编一个值出来（例如给 read_logs 硬塞一个假的 keyword）。
    /// </summary>
    public ToolDef(string name, string desc, object properties, string[]? required)
    {
        Name = name;
        Description = desc;
        var props = JsonSerializer.SerializeToElement(properties);
        var names = required ?? props.EnumerateObject().Select(p => p.Name).ToArray();
        Parameters = new { type = "object", properties, required = names };
    }
}
