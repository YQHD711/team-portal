using System.Text;

namespace TeamPortal.Services;

/// <summary>
/// P1-2：把学习库（阶段/课时结构）导出成**检索侧的虚拟索引文档**，让「工程部怎么学」这类中文提问
/// 能自然命中，而不是让模型拿通用建议糊弄。
///
/// 为什么是虚拟文档、不落盘 .md（规格「明确不做：不动知识库内容结构」）：
///   - 落盘会自动出现在知识库树 / 下载 / 搜索结果里，等于往用户可见的知识库塞自动生成物；
///   - 虚拟文档只存在于 <see cref="KnowledgeSearchService"/> 的索引里（复用 P1-1 为桥接伪块准备的
///     "非文件内容"位置），不落盘、不进树、不占磁盘，也**不需要后台任务、不调 AI**（零 token）。
///
/// 数据源与 /study 页面**完全同一份**：KnowledgeService.GetTree + StudyLibraryService.Build/Enrich
/// （同一个解析，不复制第二套）。索引按 admin 视角构建以覆盖所有部门，可见性交给检索时的路径 ACL。
/// 每个部门一份（规格要求），标题带部门名、正文含阶段顺序 + 课时清单 + 阶段说明/门槛文本。
/// </summary>
internal static class StudyIndexDocBuilder
{
    /// <summary>总览正文截断长度：说明/门槛一般在文件前部，太长的整篇塞进索引没意义。</summary>
    public const int MaxOverviewChars = 2000;
    /// <summary>单个阶段说明的截断长度。</summary>
    public const int MaxStageChars = 600;

    /// <summary>构造虚拟索引文档（Path 取该作用域的学习路径总览文件；没有则用约定路径）。</summary>
    public static List<(string Path, string Text)> Build(KnowledgeService knowledge)
    {
        var tree = knowledge.GetTree("admin", null, 0);
        return StudyLibraryService.Build(tree, "admin", null)
            .Select(s => StudyLibraryService.Enrich(s, knowledge))
            .Select(ToDoc)
            .ToList();
    }

    internal static (string Path, string Text) ToDoc(StudyScope scope)
    {
        var path = scope.OverviewPath ?? $"{scope.LibraryPath}/{StudyLibraryService.OverviewDocName}.md";
        return (path, BuildText(scope));
    }

    /// <summary>虚拟文档正文：标题（含部门名，保证中文 query 能命中）+ 阶段顺序 + 课时 + 门槛/说明。</summary>
    internal static string BuildText(StudyScope scope)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"{scope.Label} 学习路径（部门：{scope.Scope}，目录：{scope.LibraryPath}）");
        sb.AppendLine($"{scope.Scope}怎么学：按下面的阶段顺序推进，每课的详情与打勾进度在 /study 页面。");
        sb.AppendLine();

        sb.AppendLine("【学习路径总览】");
        if (scope.Duration is not null) sb.AppendLine($"总时长：{scope.Duration}");
        if (scope.Goal is not null) sb.AppendLine($"学习目标：{scope.Goal}");
        sb.AppendLine(Truncate(scope.Overview, MaxOverviewChars) ?? "（该部门还没写 _学习路径.md 总览）");
        sb.AppendLine();

        sb.AppendLine("【阶段顺序与课时清单】");
        var index = 0;
        foreach (var stage in scope.Stages)
        {
            index++;
            sb.AppendLine($"阶段 {index}：{stage.Title}");
            if (stage.Goal is not null) sb.AppendLine($"  阶段目标：{stage.Goal}");
            if (stage.Duration is not null) sb.AppendLine($"  预计时长：{stage.Duration}");
            sb.AppendLine($"  课时（{stage.Lessons.Count} 课）：{string.Join("、", stage.Lessons.Select(l => l.Title))}");
            var description = Truncate(stage.Description, MaxStageChars);
            if (description is not null) sb.AppendLine($"  阶段说明/门槛：{description}");
        }

        return sb.ToString();
    }

    /// <summary>空白压成单个空格并截断（索引文本不需要保留排版）。</summary>
    private static string? Truncate(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var flat = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return flat.Length <= max ? flat : flat[..max] + "…";
    }
}
