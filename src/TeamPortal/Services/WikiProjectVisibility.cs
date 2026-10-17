using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

/// <summary>
/// **Wiki 项目级可见性**的唯一实现（审计 #13）。
///
/// 背景：知识库读接口原来只有*路径级* ACL（`KnowledgeAcl`：公共/本部门），
/// 挡不住「同一部门里别人的 personal 项目」——wiki 文档就落在
/// `{TargetFolder}/{ProjectName}/xxx.md`，知道路径就能直读正文。
/// 检索层早就补了按 `Visibility` 的过滤，但 `/api/knowledge/content`、`/download`
/// 与 MCP `knowledge_read` 绕过了它。这里把规则收口成一处，避免三处判据漂移。
/// </summary>
public static class WikiProjectVisibility
{
    /// <summary>
    /// 对调用者**不可见**的 wiki 项目目录名：
    ///  - 别的部门的 department 项目
    ///  - 别人的 personal 项目
    /// admin 无限制（返回空集合）。
    /// </summary>
    public static HashSet<string> InvisibleProjectNames(AppDbContext db, string? role, string? department, int userId)
    {
        if (role == "admin") return new HashSet<string>(StringComparer.Ordinal);
        var deptProjects = db.WikiTasks
            .Where(t => t.Visibility == "department" && t.TargetFolder != department)
            .Select(t => t.ProjectName);
        var personalProjects = db.WikiTasks
            .Where(t => t.Visibility == "personal" && t.UserId != userId)
            .Select(t => t.ProjectName);
        return deptProjects.AsEnumerable().Union(personalProjects.AsEnumerable()).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>相对路径是否落在一个对调用者不可见的 wiki 项目里。</summary>
    public static bool IsInvisibleProject(string relPath, HashSet<string> invisibleProjectNames)
        => KnowledgeAcl.IsInvisibleWikiProject(relPath, invisibleProjectNames);
}
