namespace TeamPortal.Services;

public class KnowledgeService
{
    private readonly string _basePath;

    public KnowledgeService(IConfiguration config)
    {
        _basePath = config.GetValue<string>("Knowledge:BasePath")
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "data", "knowledge");
    }

    public List<TreeNode> GetTree(string? role, string? department)
    {
        EnsureDirectories();
        var nodes = new List<TreeNode>();

        // Public knowledge — always visible
        var publicPath = Path.Combine(_basePath, "公共");
        if (Directory.Exists(publicPath))
            nodes.Add(new TreeNode { Name = "公共知识库", Type = "folder", Path = "公共", Children = ScanDirectory(publicPath) });
        else
            nodes.Add(new TreeNode { Name = "公共知识库", Type = "folder", Path = "公共", Children = new() });

        // Department knowledge
        if (role == "admin")
        {
            // Admin sees all department folders
            foreach (var deptDir in Directory.GetDirectories(_basePath).OrderBy(Path.GetFileName))
            {
                var name = Path.GetFileName(deptDir);
                if (name == "公共") continue;
                nodes.Add(new TreeNode { Name = name, Type = "folder", Path = name, Children = ScanDirectory(deptDir) });
            }
        }
        else if (!string.IsNullOrEmpty(department))
        {
            var deptPath = Path.Combine(_basePath, department);
            if (Directory.Exists(deptPath))
                nodes.Add(new TreeNode { Name = department, Type = "folder", Path = department, Children = ScanDirectory(deptPath) });
        }

        return nodes;
    }

    public string? GetContent(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null || !File.Exists(fullPath)) return null;
        return File.ReadAllText(fullPath);
    }

    public void WriteFile(string relativePath, string content)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null) throw new InvalidOperationException("Invalid path");
        var dir = Path.GetDirectoryName(fullPath);
        if (dir is not null) Directory.CreateDirectory(dir);
        File.WriteAllText(fullPath, content);
    }

    public void DeleteFile(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null) throw new InvalidOperationException("Invalid path");
        if (Directory.Exists(fullPath)) Directory.Delete(fullPath, true);
        else if (File.Exists(fullPath)) File.Delete(fullPath);
        else throw new InvalidOperationException("File not found");
    }

    public bool CanAccess(string relativePath, string? role, string? department)
    {
        if (role == "admin") return true;
        if (relativePath.StartsWith("公共") || relativePath.StartsWith("公共/")) return true;
        if (!string.IsNullOrEmpty(department) && (relativePath == department || relativePath.StartsWith(department + "/"))) return true;
        return false;
    }

    public void EnsureDirectories()
    {
        Directory.CreateDirectory(_basePath);
        Directory.CreateDirectory(Path.Combine(_basePath, "公共"));
    }

    public void CreateDepartmentFolder(string departmentName)
    {
        Directory.CreateDirectory(Path.Combine(_basePath, departmentName));
    }

    private List<TreeNode> ScanDirectory(string dir)
    {
        var nodes = new List<TreeNode>();
        foreach (var subDir in Directory.GetDirectories(dir).OrderBy(Path.GetFileName))
            nodes.Add(new TreeNode { Name = Path.GetFileName(subDir), Type = "folder", Path = Path.GetRelativePath(_basePath, subDir).Replace('\\', '/'), Children = ScanDirectory(subDir) });
        foreach (var file in Directory.GetFiles(dir, "*.md").Where(f => !f.EndsWith(".gitkeep")).OrderBy(Path.GetFileName))
            nodes.Add(new TreeNode { Name = Path.GetFileNameWithoutExtension(file), Type = "file", Path = Path.GetRelativePath(_basePath, file).Replace('\\', '/') });
        return nodes;
    }

    private string? ResolvePath(string relativePath)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_basePath, relativePath));
        var normalizedBase = Path.GetFullPath(_basePath);
        if (!fullPath.StartsWith(normalizedBase + Path.DirectorySeparatorChar) && fullPath != normalizedBase) return null;
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
