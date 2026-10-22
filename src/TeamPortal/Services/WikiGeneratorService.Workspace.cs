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
                // 审计 #14：协议校验挡不住"让服务器去打内网/云元数据"（半盲 SSRF）。
                // 这里再要求主机解析结果全部是公网地址；解析失败/指向内网一律拒绝。
                await OutboundUrlGuard.EnsureAllowedHostAsync(new Uri(cloneUrl));
                var psi = new ProcessStartInfo("git")
                {
                    RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true
                };
                // git 自身也可能被 302 到内网地址（URL 校验只看第一跳）→ 禁止跟随重定向
                psi.ArgumentList.Add("-c");
                psi.ArgumentList.Add("http.followRedirects=false");
                // FIX-02（审计 I-01/I-02）：**不按符号链接检出**。默认 core.symlinks=true 时仓库里的
                // `leak -> /data` 会被原样建成链接，之后 /blob 与 AI 的 read_file/search_code 就能读到
                // 知识库外的库文件/令牌。置 false 后 git 把链接写成"内容为目标路径"的普通文件。
                psi.ArgumentList.Add("-c");
                psi.ArgumentList.Add("core.symlinks=false");
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

                // 审计 #14：stderr 原文不再回给调用方 —— 它能把「connection refused / timeout / 404」
                // 区分开，等于给攻击者一个探测内网端口的 oracle。细节只进服务端日志。
                if (proc.ExitCode != 0)
                {
                    _logger.LogWarning("git clone 失败 exit={Exit} stderr={Stderr}", proc.ExitCode, stderr[..Math.Min(500, stderr.Length)]);
                    throw new InvalidOperationException("Git clone 失败：仓库不可访问或地址不可达");
                }

                // FIX-02：上面 -c core.symlinks=false 是第一道；这里再扫描一遍，检出即整体失败（fail closed）。
                EnsureNoLinks(cloneDir);
                return cloneDir;
            }
            else // zip
            {
                // 统一从 SafeZipExtractor 解码 archive:: 地址（M-11 的清理逻辑也用它，避免两套解析）
                var zipPath = SafeZipExtractor.TryDecodeArchiveSource(task.SourceUrl)
                    ?? throw new InvalidOperationException("ZIP 源码包地址无法解析");
                if (!File.Exists(zipPath))
                    throw new FileNotFoundException("ZIP 源码包不存在（可能已超过保留期被清理），请重新上传", zipPath);

                var extractDir = Path.Combine(baseDir, "repo");
                // 审计 #12：受限解压（zip slip + 条目数/单文件/总量上限），不再用无限制的 ExtractToDirectory
                // 解压只会写普通文件（.NET 不会按条目重建符号链接），因此这里不需要再走 EnsureNoLinks。
                SafeZipExtractor.Extract(zipPath, extractDir);
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

    /// <summary>
    /// FIX-02（审计 I-01/I-02）：克隆完成后**整体拒绝**带符号链接 / junction 的仓库。
    ///
    /// 为什么是"整体失败"而不是"删掉链接继续"：删链接需要精确知道哪些条目是链接、
    /// 以及它们的父子关系，漏一个就留下可被 /blob 与 AI 工具利用的入口；
    /// 而失败是安全的、用户可理解的（提示移除链接后重新提交）。
    /// </summary>
    internal static void EnsureNoLinks(string workspaceDir)
    {
        var firstLink = WorkspacePathGuard.FindFirstLink(workspaceDir);
        if (firstLink is not null)
            throw new InvalidOperationException($"仓库包含符号链接（{firstLink}），已拒绝；请移除链接后重新提交");
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
