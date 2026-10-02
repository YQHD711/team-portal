using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 「仅克隆」：只把源码拉进工作区，不调用任何 AI、不生成任何文档。
///
/// 两个入口共用同一套克隆逻辑（PrepareWorkspace），避免复制粘贴：
///   1) 新建任务时勾选「仅克隆」—— 想先拿到源码浏览，不想付 AI 生成的钱；
///   2) 老任务的工作区丢失后「重新克隆」—— 部署重建容器会清空 /tmp 工作区，
///      此时任务是记录还在、源码浏览 404，按需把源码拉回来即可，不必重跑一次昂贵的生成。
///
/// 失败时：PrepareWorkspace 已清掉半成品目录，这里也**绝不**把坏路径写进 WorkspacePath。
/// </summary>
public partial class WikiGeneratorService
{
    public record WikiCloneResult(bool Ok, string Message, string? WorkspacePath);
    public record WikiCloneSubmitResult(bool Ok, string Message, WikiTask? Task);

    /// <summary>
    /// 新建「仅克隆」任务：先拉源码，成功后才把任务以**终结态**写入库。
    /// 先克隆后入库有两个好处：任务不会以 pending 停在队列里等 worker，
    /// 也不会和后台 worker 抢同一个工作区（两次克隆写同一目录会把目录搅坏）。
    /// </summary>
    public async Task<WikiCloneSubmitResult> SubmitCloneOnly(
        string type, string sourceUrl, string projectName, string targetFolder, int userId, string visibility)
    {
        var task = new WikiTask
        {
            Type = type, SourceUrl = sourceUrl, ProjectName = projectName, TargetFolder = targetFolder,
            UserId = userId, Visibility = visibility, CloneOnly = true, Status = "pending",
        };
        _currentTaskId = task.Id;
        _progress.Set(task.Id, "preparing", 0, 0, "正在拉取源码（不调用 AI）");
        try
        {
            task.WorkspacePath = await PrepareWorkspace(task); // 临时对象：PrepareWorkspace 只用 Id/Type/SourceUrl
            task.Status = "completed";
            task.CompletedAt = DateTime.UtcNow;
            _db.WikiTasks.Add(task);
            await _db.SaveChangesAsync();
            _progress.Set(task.Id, "completed", 0, 0, "源码已就绪");
            _logger.LogInformation("Wiki clone-only task {TaskId} ready: {Path}", task.Id, task.WorkspacePath);
            await CleanupWorkspacesAsync(task.Id); // 持久化后磁盘会涨，克隆成功即执行一次保留策略
            return new WikiCloneSubmitResult(true, "源码已就绪，可浏览目录与文件", task);
        }
        catch (Exception ex)
        {
            // 克隆失败就不建任务（留一条查不到源码的失败任务只会让任务列表更乱）
            _logger.LogError(ex, "Wiki clone-only task for {Project} failed", projectName);
            var message = $"源码拉取失败：{ex.Message}";
            _progress.Set(task.Id, "failed", 0, 0, message);
            return new WikiCloneSubmitResult(false, message, null);
        }
    }

    /// <summary>仅准备源码工作区（克隆/解压）。已有可用工作区时不重复下载。</summary>
    public async Task<WikiCloneResult> CloneWorkspaceOnly(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return new WikiCloneResult(false, "任务不存在", null);
        if (task.Type is not ("git" or "zip"))
            return new WikiCloneResult(false, "只有 Git/ZIP 任务可以仅克隆源码", null);

        var existing = ReusableWorkspace(task);
        if (existing is not null) return await AlreadyReady(task, existing);

        _currentTaskId = task.Id;
        _progress.Set(task.Id, "preparing", 0, 0, "正在拉取源码（不调用 AI）");
        try
        {
            var workspace = await PrepareWorkspace(task); // 失败时内部已清理，不留半个目录
            task.WorkspacePath = workspace;
            if (task.CloneOnly) MarkCloneOnlyDone(task);
            await _db.SaveChangesAsync();
            _progress.Set(task.Id, "completed", 0, 0, "源码已就绪");
            _logger.LogInformation("Wiki task {TaskId} workspace ready via clone-only: {Path}", task.Id, workspace);
            await CleanupWorkspacesAsync(task.Id); // 保留策略：刚恢复的这个任务一定留下
            return new WikiCloneResult(true, "源码已就绪，可浏览目录与文件", workspace);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki task {TaskId} clone-only failed", taskId);
            var message = $"源码拉取失败：{ex.Message}";
            if (task.CloneOnly)
            {
                task.Status = "failed";
                task.ErrorMessage = message;
                task.CompletedAt = DateTime.UtcNow;
            }
            // 重新克隆的老任务：文档仍在，只报告这次操作失败，不改任务既有状态/错误信息。
            _progress.Set(task.Id, "failed", 0, 0, message);
            await _db.SaveChangesAsync();
            return new WikiCloneResult(false, message, null);
        }
    }

    /// <summary>工作区已存在：若是「仅克隆」任务仍停在非终结态，顺手收尾（幂等）。</summary>
    private async Task<WikiCloneResult> AlreadyReady(WikiTask task, string path)
    {
        if (task.CloneOnly && task.Status is not ("completed" or "failed"))
        {
            MarkCloneOnlyDone(task);
            await _db.SaveChangesAsync();
        }
        _progress.Set(task.Id, "completed", 0, 0, "源码已就绪");
        return new WikiCloneResult(true, "源码工作区已存在，无需重新克隆", path);
    }

    /// <summary>「仅克隆」任务整个任务就这一次克隆：成功即可终结（不会停在 pending，也没有文档）。</summary>
    private static void MarkCloneOnlyDone(WikiTask task)
    {
        task.Status = "completed";
        task.CompletedAt = DateTime.UtcNow;
        task.ErrorMessage = null;
    }
}
