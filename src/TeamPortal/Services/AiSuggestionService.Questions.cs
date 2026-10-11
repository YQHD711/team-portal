using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 建议问题的"挑文档 / 抽小节"策略（从 AiSuggestionService.cs 拆出，那里已接近 200 行）。
///
/// 挑文档：队内自产关键词（物料/规范/章程/总结…）优先，中文标题优先，目录越浅越"通用"；
/// 抽小节：只认正文里**真实存在**的 `##`/`###` 标题，优先"能问的"（领用/流程/规定/安全…），
/// 其次含中文的，最后任意一个；全都没有就退化成"《X》讲了什么？"。
/// 题面里的文档名与小节名都来自真实文件，**绝不编造**。
/// </summary>
public partial class AiSuggestionService
{
    private static readonly string[] TeamDocKeywords =
        ["物料", "规范", "制度", "章程", "总结", "手册", "流程", "指南", "安全", "须知", "考核", "职责"];

    /// <summary>队内自产文档优先，中文标题优先，目录越浅越通用。</summary>
    private static int Score(TreeNode file)
    {
        var title = DisplayTitle(file.Name);
        var score = 0;
        if (TeamDocKeywords.Any(k => title.Contains(k) || (file.Path?.Contains(k) ?? false))) score += 4;
        if (HasCjk(title)) score += 2;
        score += Math.Max(0, 3 - file.Path!.Count(c => c == '/'));
        return score;
    }

    /// <summary>给用户看的文档名：去扩展名、去 `01-` / `1.2` 之类的排序编号前缀。</summary>
    internal static string DisplayTitle(string fileName)
    {
        var name = fileName.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? fileName[..^3] : fileName;
        name = Regex.Replace(name, @"^\d+(\.\d+)*[._\-、\s]+", "").Trim();
        return name.Length == 0 ? fileName : name;
    }

    private static readonly Regex HeadingRx = new(@"^#{2,3}\s+(.+)$", RegexOptions.Multiline);
    /// <summary>这些小节名当题面没有信息量（"目录是什么？"），跳过。</summary>
    private static readonly string[] SkipHeadings =
        ["目录", "概述", "简介", "参考", "参考资料", "附录", "相关链接", "更新日志", "版本历史", "导航"];
    /// <summary>像"能问的问题"的小节：流程/规定/要求/领用…（优先挑这些，题面才有回答价值）。</summary>
    private static readonly string[] AskableHeadings =
        ["领用", "入库", "出库", "借用", "归还", "申请", "流程", "规定", "要求", "标准", "职责", "验收", "考核", "安全", "检查", "处罚", "报销"];

    /// <summary>从正文开头挑一个真实存在的 `##/###` 小节标题：优先"能问的"，其次含中文的，最后任意。</summary>
    internal static string? BestHeading(string head)
    {
        var headings = ExtractHeadings(head);
        return headings.FirstOrDefault(h => AskableHeadings.Any(k => h.Contains(k)))
               ?? headings.FirstOrDefault(HasCjk)
               ?? headings.FirstOrDefault();
    }

    internal static List<string> ExtractHeadings(string head)
    {
        var list = new List<string>();
        foreach (Match m in HeadingRx.Matches(head ?? ""))
        {
            var title = CleanHeading(m.Groups[1].Value);
            if (title.Length is < 2 or > 40) continue;
            if (SkipHeadings.Contains(title)) continue;
            if (!list.Contains(title)) list.Add(title);
        }
        return list;
    }

    /// <summary>去掉标题里的 Markdown 装饰（加粗、反引号、链接、结尾冒号）。</summary>
    internal static string CleanHeading(string raw)
    {
        var text = Regex.Replace(raw, @"\[([^\]]*)\]\([^)]*\)", "$1");   // [文本](链接) → 文本
        text = text.Replace("**", "").Replace("`", "").Replace("*", "").Trim();
        return text.TrimEnd('：', ':', '。', '.', ' ');
    }

    internal static bool HasCjk(string? s) => s is not null && s.Any(c => c >= 0x4E00 && c <= 0x9FFF);
}
