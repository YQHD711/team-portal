namespace TeamPortal.Services;

/// <summary>
/// 知识库路径级访问规则的纯函数实现。
/// 检索层(KnowledgeSearchService)是单例、拿不到 scoped 的 KnowledgeService,
/// 因此把规则独立出来复用,避免"树上有过滤、搜索没过滤"造成的越权读取。
/// 入参 relPath 必须是已归一化、以 '/' 分隔的 basePath 相对路径。
/// </summary>
internal static class KnowledgeAcl
{
    /// <summary>公共目录(树里合并展示的两个命名)。</summary>
    private static readonly string[] PublicRoots = { "公共", "公共知识库" };

    public static bool CanAccess(string? relPath, string? role, string? department)
    {
        if (role == "admin") return true;
        if (string.IsNullOrWhiteSpace(relPath)) return false;

        var rel = relPath.Replace('\\', '/').Trim('/');
        if (rel.Length == 0) return false;
        // 归一化后仍含 . / .. 段一律拒绝(Windows 的 GetFullPath 会消掉,Linux 不会)
        if (rel.Split('/').Any(seg => seg is "." or "..")) return false;

        var segments = rel.Split('/');
        if (segments.Length == 1) return true; // 历史根级文件对所有人可见

        var root = segments[0];
        if (PublicRoots.Contains(root, StringComparer.Ordinal)) return true;
        if (!string.IsNullOrEmpty(department) && string.Equals(root, department, StringComparison.Ordinal)) return true;
        return false;
    }

    /// <summary>
    /// wiki 项目按 Visibility 决定的可见性:项目目录名出现在不可见集合里就必须排除
    /// (路径级 ACL 只看部门,挡不住同部门下的他人 personal 项目)。
    /// wiki 项目目录位于顶层目录(公共/某部门)之下,故取第 2 段比对。
    /// </summary>
    public static bool IsInvisibleWikiProject(string relPath, HashSet<string> invisibleProjectNames)
    {
        if (invisibleProjectNames.Count == 0) return false;
        var segments = relPath.Replace('\\', '/').Split('/');
        return segments.Length >= 2 && invisibleProjectNames.Contains(segments[1]);
    }
}
