using System.Diagnostics;
using System.Text;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的工作区准备部分：克隆/解压源码（失败时清理半成品目录）、
/// 项目类型识别、目录树构建、README 与入口文件收集。
/// 复杂度检测见 WikiGeneratorService.Complexity.cs。
/// </summary>
public partial class WikiGeneratorService
{
    // ════════════════════════════════════════
    //  Workspace Preparation
    // ════════════════════════════════════════

    private async Task<string> PrepareWorkspace(WikiTask task)
    {
        // 根目录取自设置 Wiki:WorkspaceRoot（默认 /data/wiki-workspaces，容器里是挂卷目录），
        // 不再是 /tmp —— 那正是「重建容器后源码浏览全 404」的根因。见 WikiGeneratorService.Retention.cs
        var baseDir = await WorkspaceDirAsync(task.Id);
        Directory.CreateDirectory(baseDir);

        try
        {
            if (task.Type == "git")
            {
                var cloneDir = Path.Combine(baseDir, "repo");
                if (Directory.Exists(cloneDir)) Directory.Delete(cloneDir, true);

                var cloneUrl = ValidateCloneUrl(task.SourceUrl);
                var psi = new ProcessStartInfo("git")
                {
                    RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
                };
                // 用 ArgumentList 传参而非拼命令行字符串:仓库 URL 来自用户输入,
                // 拼接会允许 `--upload-pack=...` 之类选项注入,而 ext::/file:// 协议会在
                // git 解析仓库地址时触发命令执行或本地文件读取。
                psi.ArgumentList.Add("clone");
                psi.ArgumentList.Add("--depth");
                psi.ArgumentList.Add("1");
                psi.ArgumentList.Add("--");
                psi.ArgumentList.Add(cloneUrl);
                psi.ArgumentList.Add(cloneDir);
                var proc = Process.Start(psi)!;
                var stdout = await proc.StandardOutput.ReadToEndAsync();
                var stderr = await proc.StandardError.ReadToEndAsync();
                await proc.WaitForExitAsync();

                if (proc.ExitCode != 0)
                    throw new InvalidOperationException($"Git clone failed: {stderr}");

                return cloneDir;
            }
            else // zip
            {
                var zipPath = Encoding.UTF8.GetString(Convert.FromBase64String(task.SourceUrl.Replace("archive::", "")));
                if (!File.Exists(zipPath)) throw new FileNotFoundException("ZIP file not found", zipPath);

                var extractDir = Path.Combine(baseDir, "repo");
                System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, extractDir, true);
                return extractDir;
            }
        }
        catch
        {
            // 克隆/解压中途失败绝不能留下半个目录:
            // 半成品目录会让「工作区是否存在」的诊断说谎,用户点开源码浏览只会看到残缺的文件树。
            CleanupWorkspace(baseDir);
            throw;
        }
    }

    /// <summary>尽力删除工作区目录；失败也不抛（调用方正在处理真正的错误）。</summary>
    private static void CleanupWorkspace(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { /* best effort */ }
    }

    // ════════════════════════════════════════
    //  Project Context — 项目上下文收集
    // ════════════════════════════════════════

    /// <summary>
    /// 校验并规范化 git 仓库地址。
    /// 只允许 http/https:git 支持 ext::、file:// 等传输协议,前者可直接执行命令,
    /// 后者能读取服务端任意本地文件,必须在这里挡掉;同时拒绝非绝对 URL(如 --upload-pack=...)。
    /// </summary>
    internal static string ValidateCloneUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("仓库地址不能为空");
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri))
            throw new InvalidOperationException("仓库地址不是合法的绝对 URL");
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            throw new InvalidOperationException($"不支持的仓库协议: {uri.Scheme}（仅允许 http/https）");
        return uri.ToString();
    }

    private string DetectProjectType()
    {
        var root = _workspacePath;
        var types = new List<string>();
        if (Directory.GetFiles(root, "*.csproj", SearchOption.AllDirectories).Any() || Directory.GetFiles(root, "*.sln").Any()) types.Add("dotnet");
        if (File.Exists(Path.Combine(root, "package.json")))
        {
            var pkg = File.ReadAllText(Path.Combine(root, "package.json"));
            types.Add(pkg.Contains("\"next\"") || pkg.Contains("\"react\"") || pkg.Contains("\"vue\"") ? "frontend" : "nodejs");
        }
        if (Directory.GetFiles(root, "pom.xml").Any() || Directory.GetFiles(root, "build.gradle*").Any()) types.Add("java");
        if (File.Exists(Path.Combine(root, "go.mod"))) types.Add("go");
        if (File.Exists(Path.Combine(root, "requirements.txt")) || File.Exists(Path.Combine(root, "pyproject.toml")) || File.Exists(Path.Combine(root, "setup.py"))) types.Add("python");
        if (File.Exists(Path.Combine(root, "Cargo.toml"))) types.Add("rust");
        if (types.Count == 0) return "unknown";
        if (types.Count > 1) return "fullstack:" + string.Join("+", types);
        return types[0];
    }

    private string BuildDirectoryTree()
    {
        var sb = new StringBuilder();
        BuildTreeRecursive(_workspacePath, "", sb, 0, 3);
        return sb.ToString();
    }

    private void BuildTreeRecursive(string dir, string prefix, StringBuilder sb, int depth, int maxDepth)
    {
        if (maxDepth >= 0 && depth > maxDepth) return; // -1 = unlimited
        try
        {
            foreach (var subDir in Directory.GetDirectories(dir).OrderBy(Path.GetFileName))
            {
                var name = Path.GetFileName(subDir);
                if (name.StartsWith('.') || ExcludedDirs.Contains(name)) continue;
                sb.AppendLine($"{prefix}├── 📁 {name}");
                BuildTreeRecursive(subDir, prefix + "│   ", sb, depth + 1, maxDepth);
            }
            if (depth <= 1)
                foreach (var file in Directory.GetFiles(dir, "*.*").OrderBy(Path.GetFileName).Take(30))
                    if (!Path.GetFileName(file).StartsWith('.'))
                        sb.AppendLine($"{prefix}├── 📄 {Path.GetFileName(file)}");
        }
        catch { /* skip inaccessible */ }
    }

    private string ReadReadme()
    {
        foreach (var name in new[] { "README.md", "README.MD", "readme.md", "README" })
        {
            var path = Path.Combine(_workspacePath, name);
            if (File.Exists(path))
            {
                var text = File.ReadAllText(path);
                return text.Length > 10000 ? text[..10000] + "\n...(truncated)" : text;
            }
        }
        return "(No README found)";
    }

    private string IdentifyEntryPoints()
    {
        var entries = new List<string>();
        foreach (var pattern in new[] { "Program.cs", "Startup.cs", "main.py", "app.py", "main.go", "index.tsx", "index.ts", "App.tsx", "main.ts", "main.tsx" })
        {
            foreach (var f in Directory.GetFiles(_workspacePath, pattern, SearchOption.AllDirectories).Take(2))
            {
                var rel = Path.GetRelativePath(_workspacePath, f).Replace('\\', '/');
                if (!rel.Contains("node_modules") && !rel.Contains("bin/") && !rel.Contains("obj/"))
                    entries.Add(rel);
            }
        }
        return string.Join("\n", entries.Distinct().Take(10).Select(e => $"- {e}"));
    }
}
