namespace TeamPortal.Services;

public class KnowledgeService
{
    private readonly string _basePath;

    public KnowledgeService(IConfiguration config)
    {
        _basePath = config.GetValue<string>("Knowledge:BasePath")
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "data", "knowledge");
    }

    public List<TreeNode> GetTree()
    {
        var root = new TreeNode { Name = "知识库", Type = "folder" };

        if (!Directory.Exists(_basePath))
        {
            Directory.CreateDirectory(_basePath);
            return new List<TreeNode> { root };
        }

        root.Children = ScanDirectory(_basePath);
        return new List<TreeNode> { root };
    }

    public string? GetContent(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null || !File.Exists(fullPath))
            return null;

        return File.ReadAllText(fullPath);
    }

    private List<TreeNode> ScanDirectory(string dir)
    {
        var nodes = new List<TreeNode>();

        foreach (var subDir in Directory.GetDirectories(dir).OrderBy(Path.GetFileName))
        {
            nodes.Add(new TreeNode
            {
                Name = Path.GetFileName(subDir),
                Type = "folder",
                Children = ScanDirectory(subDir),
            });
        }

        foreach (var file in Directory.GetFiles(dir, "*.md").OrderBy(Path.GetFileName))
        {
            nodes.Add(new TreeNode
            {
                Name = Path.GetFileNameWithoutExtension(file),
                Type = "file",
                Path = Path.GetRelativePath(_basePath, file).Replace('\\', '/'),
            });
        }

        return nodes;
    }

    private string? ResolvePath(string relativePath)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_basePath, relativePath));
        var normalizedBase = Path.GetFullPath(_basePath);

        if (!fullPath.StartsWith(normalizedBase + Path.DirectorySeparatorChar)
            && fullPath != normalizedBase)
            return null;

        return fullPath;
    }
}

public class TreeNode
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "folder";
    public string? Path { get; set; }
    public List<TreeNode>? Children { get; set; }
}
