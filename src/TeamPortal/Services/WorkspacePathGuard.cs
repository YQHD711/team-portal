namespace TeamPortal.Services;

/// <summary>
/// 工作区路径守卫（审计 I-01 / I-02，FIX-02）。
///
/// 把"来自用户 / 模型 / URL 的相对路径"解析成**真实路径**——逐段跟随符号链接（含中间目录的链接）——
/// 再断言它仍然落在工作区根之内。
///
/// 为什么不能用 `Path.GetFullPath` + `StartsWith`：`GetFullPath` 只做字符串规范化，**不解析链接**。
/// `git clone` 会按仓库内容检出符号链接（Linux 默认 `core.symlinks=true`），于是
/// `&lt;workspace&gt;/leak/teamportal.db` 在字符串上位于根内，实际读到的却是知识库外的库文件/令牌。
///
/// 解析策略：每轮找出路径上**最浅的一个**链接组件，替换成它的最终目标，直到没有链接为止（最多 <see cref="MaxLinkHops"/> 轮）。
/// 链接目标的父目录若也是链接，下一轮会再次被处理；成环会在达到上限后判为不安全（fail closed）。
/// 调用方应使用返回的真实路径去读文件，而不是自己再拼一次。
/// </summary>
public static class WorkspacePathGuard
{
    /// <summary>链接解析最大轮数：既覆盖真实仓库里的深层链接，也让成环快速失败。</summary>
    public const int MaxLinkHops = 40;

    private static readonly char[] Separators = { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar };

    /// <summary>解析并断言；根不存在 / 路径非法 / 越界 / 链接成环一律返回 null（调用方按 403/错误处理）。</summary>
    public static string? TryResolveInside(string? root, string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(root)) return null;

        string rootFull;
        try { rootFull = Path.GetFullPath(root); }
        catch (Exception) { return null; }
        if (!Directory.Exists(rootFull)) return null;   // 根不存在就不存在"工作区"，一律拒绝

        var rootReal = Canonicalize(rootFull);
        if (rootReal is null) return null;
        rootReal = rootReal.TrimEnd(Separators);
        if (rootReal.Length == 0) return null;          // 根是 "/" 或盘符：不支持（工作区根不可能是文件系统根）

        var rel = (relativePath ?? string.Empty)
            .Replace('\\', Path.DirectorySeparatorChar)   // 模型有时给 Windows 风格分隔符
            .Trim();
        if (rel.Length == 0) return rootReal;           // 空路径 = 工作区根（list_files 的默认行为）
        if (rel.IndexOf('\0') >= 0) return null;
        if (Path.IsPathRooted(rel)) return null;        // 绝对路径 / 盘符 / UNC

        var segments = rel.Split(Separators, StringSplitOptions.RemoveEmptyEntries);
        // 显式拒绝 . / ..：它们能改变最终落点，合法调用方（URL 分段、catalog path）不需要它们。
        if (segments.Length == 0 || segments.Any(s => s is "." or "..")) return null;

        string combined;
        try { combined = Path.GetFullPath(Path.Combine(new[] { rootReal }.Concat(segments).ToArray())); }
        catch (Exception) { return null; }

        var real = Canonicalize(combined);
        if (real is null) return null;
        real = real.TrimEnd(Separators);
        if (real.Length == 0) return null;

        if (string.Equals(real, rootReal, StringComparison.OrdinalIgnoreCase)) return real;
        // 必须是"根 + 目录分隔符"前缀：否则 /data/kb2 会被当成 /data/kb 的子目录（审计 #33 的教训）
        if (!real.StartsWith(rootReal + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
        return real;
    }

    /// <summary>同 <see cref="TryResolveInside"/>，不安全时抛 <see cref="InvalidOperationException"/>（AI 工具直接用）。</summary>
    public static string ResolveInside(string? root, string? relativePath)
        => TryResolveInside(root, relativePath) ?? throw new InvalidOperationException("Path traversal denied");

    /// <summary>把路径上的所有链接展开成真实路径；遇到读不出目标的链接或层数超限返回 null（fail closed）。</summary>
    private static string? Canonicalize(string path)
    {
        string current;
        try { current = Path.GetFullPath(path); }
        catch (Exception) { return null; }

        for (var hop = 0; hop < MaxLinkHops; hop++)
        {
            var (isLink, target, remainder) = FirstLink(current);
            if (!isLink) return current;
            if (target is null) return null;   // 是链接但目标读不出来 → 不冒这个险
            // 链接可能在路径**中间**：必须把链接组件之后的剩余段接回目标，
            // 否则 <root>/link/a.cs 会被解析成 <root>/src（丢掉 a.cs），既误判归属也会读错文件。
            current = remainder.Length == 0
                ? target
                : Path.GetFullPath(Path.Combine(target, remainder));
        }
        return null;   // 链接层数超过上限：按环/异常处理，fail closed
    }

    /// <summary>返回路径上最浅的一个链接组件（IsLink=false 表示整条路径没有链接）。Remainder 是链接组件之后的剩余段。</summary>
    private static (bool IsLink, string? Target, string Remainder) FirstLink(string fullPath)
    {
        var rootPart = Path.GetPathRoot(fullPath);
        if (string.IsNullOrEmpty(rootPart)) return (false, null, string.Empty);

        var segments = fullPath[rootPart.Length..].Split(Separators, StringSplitOptions.RemoveEmptyEntries);

        // 盘符/根本身也可能是链接（极少）：先探一次，命中则把整条剩余路径接回目标
        var rootProbe = ProbeLink(rootPart);
        if (rootProbe.IsLink)
            return (true, rootProbe.Target, string.Join(Path.DirectorySeparatorChar, segments));

        var current = rootPart;
        for (var i = 0; i < segments.Length; i++)
        {
            current = Path.Combine(current, segments[i]);
            var probe = ProbeLink(current);
            if (probe.IsLink)
            {
                var remainder = string.Join(Path.DirectorySeparatorChar, segments.Skip(i + 1));
                return (true, probe.Target, remainder);
            }
        }
        return (false, null, string.Empty);
    }

    /// <summary>
    /// 手工递归枚举文件：**跳过所有符号链接 / junction**，且绝不递归进链接目录。
    /// 不能直接用 `SearchOption.AllDirectories` —— 它会把工作区内的目录链接当普通目录递归进去，
    /// 等于绕过本守卫读根外文件（审计 I-02 的 search_code 路径）。
    /// </summary>
    /// <param name="descend">子目录名过滤器（返回 false 表示不进入，例如 node_modules / .git）。</param>
    public static IEnumerable<string> EnumerateFilesNoLinks(string? directory, Func<string, bool>? descend = null)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)) yield break;

        var stack = new Stack<string>();
        stack.Push(directory);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            FileSystemInfo[] entries;
            try { entries = new DirectoryInfo(current).GetFileSystemInfos(); }
            catch (Exception) { continue; }   // 无权限 / 并发删除：跳过

            foreach (var info in entries)
            {
                if (IsLink(info)) continue;
                if (info is DirectoryInfo sub)
                {
                    if (descend is null || descend(sub.Name)) stack.Push(sub.FullName);
                }
                else
                {
                    yield return info.FullName;
                }
            }
        }
    }

    /// <summary>
    /// 目录树里第一个链接条目的相对路径；没有返回 null。克隆完成后用它整体拒绝带链接的仓库。
    /// 说明：枚举不了的子目录直接跳过（同样的权限下真实读取也会失败，不存在"能读却漏检"的路子）。
    /// </summary>
    public static string? FindFirstLink(string? root)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return null;

        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            FileSystemInfo[] entries;
            try { entries = new DirectoryInfo(current).GetFileSystemInfos(); }
            catch (Exception) { continue; }

            foreach (var info in entries)
            {
                if (IsLink(info)) return Path.GetRelativePath(root, info.FullName);
                if (info is DirectoryInfo sub) stack.Push(sub.FullName);
            }
        }
        return null;
    }

    /// <summary>是否符号链接 / junction（`LinkTarget` 对普通文件返回 null）；探测失败按"不是链接"处理。</summary>
    private static bool IsLink(FileSystemInfo info)
    {
        try { return (info.Attributes & FileAttributes.ReparsePoint) != 0 || info.LinkTarget is not null; }
        catch (Exception) { return false; }
    }

    private static (bool IsLink, string? Target) ProbeLink(string path)
    {
        try
        {
            FileSystemInfo info;
            if (Directory.Exists(path)) info = new DirectoryInfo(path);
            else if (File.Exists(path)) info = new FileInfo(path);
            else return (false, null);   // 不存在（或断链）：没有可读链接内容

            if ((info.Attributes & FileAttributes.ReparsePoint) == 0) return (false, null);

            var linkTarget = info.LinkTarget;   // 不要求目标存在，断链也能拿到原目标字符串
            if (string.IsNullOrEmpty(linkTarget)) return (true, null);   // 是链接却读不出目标 → fail closed

            var target = Path.IsPathRooted(linkTarget)
                ? linkTarget
                : Path.Combine(Path.GetDirectoryName(path) ?? Path.GetPathRoot(path) ?? string.Empty, linkTarget);
            return (true, Path.GetFullPath(target));
        }
        catch (Exception)
        {
            // Exists 已通过、Attributes/LinkTarget 却抛异常：极罕见（并发删除）。
            // 这里按"非链接"处理，后续真实读取会自己失败；不会因此把根外文件放进来。
            return (false, null);
        }
    }
}