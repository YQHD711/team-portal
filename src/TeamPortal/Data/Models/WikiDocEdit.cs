namespace TeamPortal.Data.Models;

/// <summary>
/// 「已人工修改」标记：某任务的某篇文档（按语言区分 zh/en）被人工通过写接口改写过。
///
/// 为什么需要：<c>POST /api/wiki/tasks/{id}/update</c> 会重新生成文档、把人工修改冲掉。
/// 方案 (c)「覆盖前确认」靠它区分「AI 生成的原稿」与「人工改过的版本」：
/// 有标记 → 先返回需要确认的信号；用户确认后才覆盖并清除标记。
/// 未被标记的文档完全不受影响。
/// </summary>
public class WikiDocEdit
{
    public int Id { get; set; }
    /// <summary>所属 WikiTask.Id（不设 FK：任务删除时由 DeleteTask 显式清理，避免级联依赖）。</summary>
    public string TaskId { get; set; } = string.Empty;
    /// <summary>目录项 path（不含 .md）。</summary>
    public string Path { get; set; } = string.Empty;
    /// <summary>zh | en —— 两种语言是两份不同的文档，标记也要分开。</summary>
    public string Lang { get; set; } = "zh";
    public DateTime MarkedAt { get; set; } = DateTime.UtcNow;
    public int? UserId { get; set; }
    public string? Editor { get; set; }
}
