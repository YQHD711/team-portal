using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

namespace TeamPortal.Services;

public class KnowledgeService
{
    private readonly string _basePath;
    private readonly LogService _log;
    private readonly IServiceScopeFactory _scopeFactory;

    public KnowledgeService(IConfiguration config, LogService log, IServiceScopeFactory scopeFactory)
    {
        _log = log;
        _scopeFactory = scopeFactory;
        _basePath = config.GetValue<string>("Knowledge:BasePath")
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "knowledge");
    }

    private HashSet<string> GetInvisibleProjects(string? role, string? dept, int userId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var deptProjects = db.WikiTasks
            .Where(t => t.Visibility == "department" && role != "admin" && t.TargetFolder != dept)
            .Select(t => t.ProjectName);
        var personalProjects = db.WikiTasks
            .Where(t => t.Visibility == "personal" && role != "admin" && t.UserId != userId)
            .Select(t => t.ProjectName);
        return deptProjects.AsEnumerable().Union(personalProjects.AsEnumerable()).ToHashSet();
    }

    public List<TreeNode> GetTree(string? role, string? department, int userId = 0)
    {
        EnsureDirectories();
        var nodes = new List<TreeNode>();
        var invisible = GetInvisibleProjects(role, department, userId);

        // Public knowledge — merge from both "公共" and "公共知识库" directories
        var publicChildren = new List<TreeNode>();

        // Files from "公共" directory
        var publicPath = Path.Combine(_basePath, "公共");
        if (Directory.Exists(publicPath))
            publicChildren.AddRange(ScanDirectory(publicPath, invisible));

        // Files from "公共知识库" directory (alternative naming, merge into same root node)
        var publicAltPath = Path.Combine(_basePath, "公共知识库");
        if (Directory.Exists(publicAltPath))
            publicChildren.AddRange(ScanDirectory(publicAltPath, invisible));

        // Root-level .md files
        foreach (var file in Directory.GetFiles(_basePath, "*.md").Where(f => !f.EndsWith(".gitkeep")))
            publicChildren.Add(new TreeNode { Name = Path.GetFileNameWithoutExtension(file), Type = "file", Path = Path.GetFileName(file) });
        nodes.Add(new TreeNode { Name = "公共知识库", Type = "folder", Path = "公共", Children = publicChildren });

        // Department knowledge
        if (role == "admin")
        {
            foreach (var deptDir in Directory.GetDirectories(_basePath).OrderBy(Path.GetFileName))
            {
                var name = Path.GetFileName(deptDir);
                if (name == "公共" || name == "公共知识库") continue;
                nodes.Add(new TreeNode { Name = name, Type = "folder", Path = name, Children = ScanDirectory(deptDir, invisible) });
            }
        }
        else if (!string.IsNullOrEmpty(department))
        {
            var deptPath = Path.Combine(_basePath, department);
            if (Directory.Exists(deptPath))
                nodes.Add(new TreeNode { Name = department, Type = "folder", Path = department, Children = ScanDirectory(deptPath, invisible) });
        }

        return nodes;
    }

    public string? GetContent(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null || !File.Exists(fullPath)) return null;
        return File.ReadAllText(fullPath);
    }

    public bool FileExists(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        return fullPath is not null && File.Exists(fullPath);
    }

    public void WriteFile(string relativePath, string content)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null) throw new InvalidOperationException("Invalid path");
        var dir = Path.GetDirectoryName(fullPath);
        if (dir is not null) Directory.CreateDirectory(dir);

        // Version history backup before overwrite
        if (File.Exists(fullPath))
        {
            var historyDir = Path.Combine(_basePath, ".history", Path.GetDirectoryName(relativePath) ?? "");
            Directory.CreateDirectory(historyDir);
            var ts = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            var backupPath = Path.Combine(historyDir, $"{Path.GetFileName(relativePath)}.{ts}.bak");
            File.Copy(fullPath, backupPath, overwrite: true);
        }

        // Atomic write: write to temp file, then rename
        var tmpPath = fullPath + ".tmp";
        File.WriteAllText(tmpPath, content);
        File.Move(tmpPath, fullPath, overwrite: true);
        _log.Info("knowledge", $"File written: {relativePath}");
    }

    public void WriteFile(string relativePath, byte[] data)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null) throw new InvalidOperationException("Invalid path");
        var dir = Path.GetDirectoryName(fullPath);
        if (dir is not null) Directory.CreateDirectory(dir);
        // Atomic write: write to temp file, then rename
        var tmpPath = fullPath + ".tmp";
        File.WriteAllBytes(tmpPath, data);
        File.Move(tmpPath, fullPath, overwrite: true);
        _log.Info("knowledge", $"Binary file written: {relativePath}");
    }

    public byte[]? GetBinaryContent(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null || !File.Exists(fullPath)) return null;
        return File.ReadAllBytes(fullPath);
    }

    public void DeleteFile(string relativePath)
    {
        var fullPath = ResolvePath(relativePath);
        if (fullPath is null) throw new InvalidOperationException("Invalid path");
        if (Directory.Exists(fullPath)) { Directory.Delete(fullPath, true); _log.Warn("knowledge", $"Directory deleted: {relativePath}"); }
        else if (File.Exists(fullPath)) { File.Delete(fullPath); _log.Warn("knowledge", $"File deleted: {relativePath}"); }
        else throw new InvalidOperationException("File not found");
    }

    /// <summary>重命名或移动文件/目录（目录结构调整）。</summary>
    public void Rename(string relativePath, string newRelativePath)
    {
        var fullPath = ResolvePath(relativePath);
        var newFullPath = ResolvePath(newRelativePath);
        if (fullPath is null || newFullPath is null) throw new InvalidOperationException("Invalid path");
        if (!File.Exists(fullPath) && !Directory.Exists(fullPath)) throw new InvalidOperationException("File not found");
        if (File.Exists(newFullPath) || Directory.Exists(newFullPath)) throw new InvalidOperationException("目标已存在");
        var newDir = Path.GetDirectoryName(newFullPath);
        if (newDir is not null) Directory.CreateDirectory(newDir);
        if (Directory.Exists(fullPath)) Directory.Move(fullPath, newFullPath);
        else File.Move(fullPath, newFullPath);
        _log.Info("knowledge", $"Renamed: {relativePath} → {newRelativePath}");
    }

    public bool CanAccess(string relativePath, string? role, string? department)
    {
        if (role == "admin") return true;
        // Legacy root-level files are public
        if (!relativePath.Contains('/')) return true;
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

    /// <summary>Get completed wiki task IDs keyed by project name.</summary>
    private Dictionary<string, string> GetWikiProjects()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return db.WikiTasks
            .Where(t => t.Status == "completed")
            .ToDictionary(t => t.ProjectName, t => t.Id);
    }

    private List<TreeNode> ScanDirectory(string dir, HashSet<string>? invisibleProjects = null)
    {
        var nodes = new List<TreeNode>();
        var wikiProjects = GetWikiProjects();

        foreach (var subDir in Directory.GetDirectories(dir).OrderBy(Path.GetFileName))
        {
            var dirName = Path.GetFileName(subDir);
            if (invisibleProjects != null && invisibleProjects.Contains(dirName)) continue;
            var relPath = Path.GetRelativePath(_basePath, subDir).Replace('\\', '/');

            // Wiki projects: collapsed entry for regular users, expandable for admins
            if (wikiProjects.TryGetValue(dirName, out var taskId))
            {
                nodes.Add(new TreeNode
                {
                    Name = dirName, Type = "wiki", Path = relPath,
                    Extra = new Dictionary<string, string> { ["taskId"] = taskId },
                    Children = ScanDirectory(subDir, invisibleProjects) // include children for admin editing
                });
            }
            else
            {
                nodes.Add(new TreeNode { Name = dirName, Type = "folder", Path = relPath, Children = ScanDirectory(subDir, invisibleProjects) });
            }
        }
        foreach (var file in Directory.GetFiles(dir).Where(f => !f.EndsWith(".gitkeep")).OrderBy(Path.GetFileName))
        {
            var ext = Path.GetExtension(file).ToLowerInvariant();
            var relPath = Path.GetRelativePath(_basePath, file).Replace('\\', '/');
            nodes.Add(new TreeNode
            {
                Name = Path.GetFileNameWithoutExtension(file),
                Type = "file",
                Path = relPath,
                Extra = new Dictionary<string, string> { ["ext"] = ext }
            });
        }
        return nodes;
    }

    private string? ResolvePath(string relativePath)
    {
        var fullPath = Path.GetFullPath(Path.Combine(_basePath, relativePath));
        var normalizedBase = Path.GetFullPath(_basePath);
        if (!fullPath.StartsWith(normalizedBase + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && !string.Equals(fullPath, normalizedBase, StringComparison.OrdinalIgnoreCase)) return null;
        return fullPath;
    }
}

public class TreeNode
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "folder";
    public string? Path { get; set; }
    public List<TreeNode>? Children { get; set; }
    public Dictionary<string, string>? Extra { get; set; }
}
