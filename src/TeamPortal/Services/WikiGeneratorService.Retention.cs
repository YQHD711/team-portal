using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// Wiki 工作区的落盘位置与保留策略。
///
/// 为什么必须持久化：工作区原先建在容器 /tmp（未挂卷），每次部署重建容器就整片清空，
/// 于是任务记录还在、文档也在，源码浏览却全部 404。改到设置 <c>Wiki:WorkspaceRoot</c>
/// （默认 <c>/data/wiki-workspaces</c>，容器里挂的是 <c>./data:/data</c>）后就能活过部署。
///
/// 持久化的代价是磁盘会无限增长，所以同一文件里配套保留策略：只留最近 N 个。
/// 被清掉工作区的任务记录照旧保留（源码浏览 404，可随时「重新克隆」）。
/// </summary>
public partial class WikiGeneratorService
{
    internal const string DefaultWorkspaceRoot = "/data/wiki-workspaces";
    internal const int DefaultWorkspaceKeep = 20;

    /// <summary>工作区根目录：设置 Wiki:WorkspaceRoot → 配置 → 默认 /data/wiki-workspaces。</summary>
    internal async Task<string> ResolveWorkspaceRootAsync()
    {
        var setting = await SettingEitherAsync("Wiki:WorkspaceRoot", "Wiki:WorkspaceRoot");
        if (!string.IsNullOrWhiteSpace(setting)) return setting.Trim();
        var cfg = _config["Wiki:WorkspaceRoot"];
        return string.IsNullOrWhiteSpace(cfg) ? DefaultWorkspaceRoot : cfg.Trim();
    }

    /// <summary>某个任务的工作区目录（根目录 + taskId）。</summary>
    internal async Task<string> WorkspaceDirAsync(string taskId) =>
        Path.Combine(await ResolveWorkspaceRootAsync(), taskId);

    /// <summary>保留多少个工作区：设置 Wiki:WorkspaceKeep → 配置 → 默认 20（下限 1，避免出现「一个都不留」）。</summary>
    internal async Task<int> ResolveWorkspaceKeepAsync()
    {
        var raw = await SettingEitherAsync("Wiki:WorkspaceKeep", "Wiki:WorkspaceKeep") ?? _config["Wiki:WorkspaceKeep"];
        return int.TryParse(raw, out var n) ? Math.Clamp(n, 1, 1000) : DefaultWorkspaceKeep;
    }

    /// <summary>
    /// 保留策略：**终态**任务按 <c>CompletedAt ?? CreatedAt</c> 倒序，只保留最近 N 个任务的工作区，
    /// 其余的目录删掉（任务记录不动）。正在运行（非终态）的任务一律跳过——它的工作区可能正在被读写。
    /// 清理失败只记日志、返回 0，绝不影响调用方的主流程。
    /// </summary>
    public async Task<int> CleanupWorkspacesAsync(string? exceptTaskId = null)
    {
        try
        {
            return await CleanupWorkspacesCoreAsync(exceptTaskId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki workspace cleanup failed");
            return 0;
        }
    }

    private async Task<int> CleanupWorkspacesCoreAsync(string? exceptTaskId)
    {
        // 去掉末尾分隔符：否则下面 StartsWith(root + sep) 永远不成立，清理会静默失效
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(await ResolveWorkspaceRootAsync()));
        if (!Directory.Exists(root)) return 0;

        var keep = await ResolveWorkspaceKeepAsync();
        var ranked = await _db.WikiTasks
            .Where(t => t.Status == "completed" || t.Status == "failed")
            .OrderByDescending(t => t.CompletedAt ?? t.CreatedAt)
            .Select(t => t.Id)
            .ToListAsync();

        // 刚克隆/刚生成完的那个任务必须留下（否则「重新克隆老任务」会被自己触发的清理立刻删掉）
        var keepIds = ranked.Where(id => id != exceptTaskId).Take(keep).ToHashSet();
        if (exceptTaskId is not null) keepIds.Add(exceptTaskId);

        var removed = 0;
        foreach (var id in ranked)
        {
            if (keepIds.Contains(id)) continue;
            var dir = Path.GetFullPath(Path.Combine(root, id));
            if (dir == root || !dir.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                continue; // 只删根目录下的一级子目录，防路径拼接意外越界
            if (!Directory.Exists(dir)) continue;
            try
            {
                Directory.Delete(dir, true);
                removed++;
                _logger.LogInformation("Wiki workspace cleaned up: {Path}", dir);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Wiki workspace cleanup skipped {Path}", dir);
            }
        }
        return removed;
    }
}
