using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace TeamPortal.Services;

/// <summary>
/// 把"用户/任务里来的相对路径"规范化为**必须落在某个根目录之内**的绝对路径（审计 #4）。
///
/// 背景：Wiki 任务删除时用 `Path.Combine(kbRoot, task.TargetFolder, task.ProjectName)` 拼回收站源路径。
/// 这两个字段来自创建时的用户输入，`../..` 就能把**任意文件**（含线上 SQLite 主库）搬进回收站。
///
/// 为什么不用 `StartsWith` 前缀比较（审计 #33 已指出）：`/data/kb2` 以 `/data/kb` 为前缀但不是子目录；
/// 必须**按路径段**比较。这里用 <see cref="Path.GetRelativePath"/>：结果以 `..` 开头或为绝对路径即为越界。
/// </summary>
public static class KnowledgePathGuard
{
    /// <summary>
    /// 安全拼接：返回落在 <paramref name="root"/> 之内的绝对路径；越界/非法返回 null。
    /// 拒绝情形：任何一段包含 `..`、结果是根目录本身、或规范化后跑出根目录。
    /// </summary>
    public static string? ResolveInside(string root, params string?[] parts)
    {
        if (string.IsNullOrWhiteSpace(root)) return null;
        if (parts is null || parts.Length == 0) return null;
        if (parts.Any(p => string.IsNullOrWhiteSpace(p))) return null;
        // 快速拒绝明显的穿越（规范化后仍会再判一次，双保险）
        if (parts.Any(p => p!.Contains("..", StringComparison.Ordinal))) return null;

        var rootFull = Path.GetFullPath(root);
        // 去掉尾部分隔符，避免 "/kb/" 与实际路径比较时多一层
        rootFull = rootFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (rootFull.Length == 0) return null;   // 根是盘符的情况交给上层校验

        string candidate;
        try
        {
            candidate = Path.GetFullPath(Path.Combine(new[] { rootFull }.Concat(parts.Select(p => p!)).ToArray()));
        }
        catch (Exception)
        {
            // 非法字符 / 过长路径等：一律拒绝，并给出可读原因由调用方处理
            return null;
        }

        var relative = Path.GetRelativePath(rootFull, candidate);
        if (relative == ".") return null;                                       // 指向根目录本身
        if (Path.IsPathRooted(relative)) return null;                           // 另一个盘/根
        if (relative.StartsWith("..", StringComparison.Ordinal)) return null;   // 越界
        if (relative.StartsWith(Path.DirectorySeparatorChar) || relative.StartsWith(Path.AltDirectorySeparatorChar))
            return null;

        return candidate;
    }

    /// <summary>批量版：任一路径非法就整体返回 null（调用方据此 400，不做部分处理）。</summary>
    public static IReadOnlyList<string>? ResolveAllInside(string root, IEnumerable<string?[]> entries)
    {
        var result = new List<string>();
        foreach (var parts in entries)
        {
            var resolved = ResolveInside(root, parts);
            if (resolved is null) return null;
            result.Add(resolved);
        }
        return result;
    }
}
