namespace TeamPortal.Services;

/// <summary>
/// 工具的 ACL 快照（单独 partial，见 KnowledgeToolSession.cs 的类注释）：
/// 允许读取的路径**只**来自 <c>KnowledgeService.GetTree(role, dept, uid)</c> ——
/// 与检索侧完全同一套 ACL（含跨部门与不可见 wiki 项目的过滤），不自己写前缀比较。
/// 一次提问只扫一次树（结果缓存在会话里）。
/// </summary>
public sealed partial class KnowledgeToolSession
{
    /// <summary>可读扩展名（与检索索引同一批文本类型）。</summary>
    private static readonly string[] TextExtensions = [".md", ".txt", ".json", ".csv", ".xml"];

    private HashSet<string>? _allowedPaths;

    private HashSet<string> AllowedPaths()
    {
        if (_allowedPaths is not null) return _allowedPaths;
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in Files(_knowledge.GetTree(_role, _department, _userId)))
        {
            var path = file.Path!;
            if (TextExtensions.Any(ext => path.EndsWith(ext, StringComparison.OrdinalIgnoreCase))) set.Add(path);
        }
        _allowedPaths = set;
        return set;
    }

    private static IEnumerable<TreeNode> Files(IEnumerable<TreeNode> nodes)
    {
        foreach (var node in nodes)
        {
            if (node.Type == "file" && !string.IsNullOrEmpty(node.Path)) yield return node;
            else if (node.Children is { Count: > 0 })
                foreach (var child in Files(node.Children)) yield return child;
        }
    }
}
