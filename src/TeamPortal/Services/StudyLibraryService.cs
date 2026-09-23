using System.Text.RegularExpressions;

namespace TeamPortal.Services;

/// <summary>
/// 学习库视图：把知识库里约定目录「学习库」的结构抽出来，按 阶段(一级子目录) → 课时(.md) 组织。
///
/// 设计要点（见 docs/ARCHITECTURE.md「学习库」）：
/// - 内容仍然是知识库里的 Markdown，没有第二份数据源；读写/搜索/备份/历史版本全部白捡。
/// - 可见范围直接吃 KnowledgeService.GetTree（已按 KnowledgeAcl 过滤）的结果，
///   本类**不自己判可见性**，避免"树上有过滤、学习库没过滤"造成越权读取。
/// - 纯函数，不碰 IO/DB，便于单测覆盖权限矩阵。
/// </summary>
public static class StudyLibraryService
{
    /// <summary>学习库的约定目录名：公共/学习库、&lt;部门&gt;/学习库。</summary>
    public const string FolderName = "学习库";

    /// <summary>下划线前缀 = 元信息文件，不当作课时显示。</summary>
    public const string OverviewDocName = "_学习路径";
    public const string StageDocName = "_阶段说明";

    /// <summary>公共作用域在知识库树里的根路径（该节点合并了 公共/ 与 公共知识库/）。</summary>
    public const string PublicScope = "公共";

    /// <summary>
    /// 该作用域能否编辑。与**真实生效**的权限保持一致：
    /// 写接口挂在 StaffOnly 组（admin + 部长），而 KnowledgeAcl 对 公共/ 与 本人部门/ 都放行，
    /// 因此部长实际能改「公共 + 本部门」，admin 全部，队员只读。
    ///
    /// 这里刻意不做得更严：UI 上藏掉一个后端仍然允许的操作，只是假限制而非安全边界。
    /// 若要把部长限制成「仅本部门」，需要改全局知识库写权限，属于单独的一次 ACL 变更。
    /// </summary>
    public static bool CanEditScope(string scope, string? role, string? department)
        => role == "admin"
           || (role == "部长" && (scope == PublicScope || (department is not null && scope == department)));

    /// <summary>从知识库树构建学习库视图（只返回实际上建了「学习库」目录的作用域）。</summary>
    public static List<StudyScope> Build(IEnumerable<TreeNode> tree, string? role, string? department)
    {
        var scopes = new List<StudyScope>();
        foreach (var root in tree)
        {
            var scopePath = root.Path;
            if (string.IsNullOrEmpty(scopePath)) continue;
            // 树本身已按 ACL 过滤，这里只是防御：非公共且非本人部门的作用域一律不展开
            if (scopePath != PublicScope && scopePath != department && role != "admin") continue;

            var lib = root.Children?.FirstOrDefault(c => c.Type == "folder" && c.Name == FolderName);
            if (lib is null) continue;

            var canEdit = CanEditScope(scopePath, role, department);
            scopes.Add(new StudyScope(
                Scope: scopePath,
                Label: scopePath == PublicScope ? "公共学习库" : $"{scopePath}学习库",
                LibraryPath: $"{scopePath}/{FolderName}",
                CanEdit: canEdit,
                OverviewPath: FindChild(lib, OverviewDocName)?.Path,
                Stages: BuildStages(lib, canEdit)));
        }
        return scopes;
    }

    private static List<StudyStage> BuildStages(TreeNode lib, bool canEdit)
        => (lib.Children ?? new List<TreeNode>())
            .Where(c => c.Type == "folder" && !string.IsNullOrEmpty(c.Path))
            .Select(stage => new StudyStage(
                Title: StripOrderPrefix(stage.Name),
                Path: stage.Path!,
                CanEdit: canEdit,
                DescriptionPath: FindChild(stage, StageDocName)?.Path,
                Lessons: (stage.Children ?? new List<TreeNode>())
                    .Where(f => f.Type == "file" && IsMarkdown(f) && !IsMeta(f.Name))
                    .Select(f => new StudyLesson(Title: StripOrderPrefix(f.Name), Path: f.Path!, CanEdit: canEdit))
                    .ToList()))
            .ToList();

    private static TreeNode? FindChild(TreeNode node, string name)
        => node.Children?.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.Ordinal));

    private static bool IsMarkdown(TreeNode n)
        => n.Extra is not null && n.Extra.TryGetValue("ext", out var ext)
           && (ext == ".md" || ext == ".markdown");

    private static bool IsMeta(string name) => name.StartsWith('_');

    /// <summary>
    /// 去掉排序用的数字前缀：「01-认识航模」→「认识航模」。
    /// 排序本身由目录/文件名决定，知识库扫描按文件名升序，
    /// 所以约定用两位数字前缀（01…12），超过 9 个阶段也不会乱序。
    /// </summary>
    internal static string StripOrderPrefix(string name)
    {
        var m = Regex.Match(name, @"^\d+\s*[-_.、\s]\s*(.+)$");
        return m.Success ? m.Groups[1].Value : name;
    }
}

public record StudyScope(
    string Scope, string Label, string LibraryPath, bool CanEdit,
    string? OverviewPath, List<StudyStage> Stages);

public record StudyStage(
    string Title, string Path, bool CanEdit,
    string? DescriptionPath, List<StudyLesson> Lessons);

public record StudyLesson(string Title, string Path, bool CanEdit);
