using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Background worker that picks pending WikiTasks and processes them.
/// Polls every 30 seconds. Only processes one task at a time.
/// </summary>
public class WikiProcessingWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<WikiProcessingWorker> _logger;

    public WikiProcessingWorker(IServiceScopeFactory scopeFactory, ILogger<WikiProcessingWorker> logger)
    {
        _scopeFactory = scopeFactory; _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Wiki processing worker started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var generator = scope.ServiceProvider.GetRequiredService<WikiGeneratorService>();

                var task = await db.WikiTasks
                    .Where(t => t.Status != "completed" && t.Status != "failed")
                    .OrderBy(t => t.CreatedAt)
                    .FirstOrDefaultAsync(stoppingToken);

                if (task != null)
                {
                    var log = scope.ServiceProvider.GetRequiredService<LogService>();
                    var notify = scope.ServiceProvider.GetRequiredService<NotificationService>();
                    log.Info("wiki", $"Processing {task.Type} task: {task.ProjectName} (status={task.Status})");
                    try
                    {
                        // 翻译功能已下线。库里可能残留历史 translate 任务，必须在这里挡掉：
                        // 若落到下面的生成管线，会克隆仓库跑一整套 AI 生成（真金白银且非用户本意）。
                        if (task.Type == "translate")
                        {
                            task.Status = "failed";
                            task.ErrorMessage = "翻译文档功能已下线，请删除该任务";
                            await db.SaveChangesAsync();
                            log.Warn("wiki", $"Legacy translate task rejected: {task.ProjectName}");
                            notify.Notify("任务失败", $"{task.ProjectName}: {task.ErrorMessage}", userId: task.UserId);
                            continue;
                        }

                        await generator.ProcessTask(task.Id);
                    }
                    catch (Exception ex)
                    {
                        if (task.Status != "failed")
                        {
                            task.Status = "failed";
                            task.ErrorMessage = ex.Message;
                            await db.SaveChangesAsync();
                        }
                        log.Error("wiki", $"Task crashed: {task.ProjectName}", ex.ToString());
                        if (task.Status == "failed")
                            notify.Notify($"任务失败", $"{task.ProjectName}: {task.ErrorMessage}", userId: task.UserId);
                        continue;
                    }
                    if (task.Status == "completed")
                    {
                        log.Info("wiki", $"Task completed: {task.ProjectName}");
                        await NotifyCompletedAsync(notify, db, task);
                    }
                    else
                    {
                        log.Error("wiki", $"Task failed: {task.ProjectName}", task.ErrorMessage);
                        notify.Notify("Wiki 生成失败", $"{task.ProjectName}: {task.ErrorMessage}", userId: task.UserId);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Wiki worker error");
            }

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    /// <summary>
    /// 任务完成通知按**任务可见性**投递，返回null表示广播（公共项目）。
    ///
    /// 原实现是无参 Notify → UserId 与 TargetRole 都是 null，等于**只要有账号就收得到**，
    /// 于是别的部门队员也会收到不相干项目的完成通知。
    ///
    /// 这里刻意**不给通知加"部门作用域"字段**：可见性判定散在 GetNotifications /
    /// GetUnreadCount / MarkAllRead / IsVisibleTo / SSE fan-out 共 6 处，
    /// 新增字段意味着 6 处都得同步改，任何一处漏掉就是一次越权泄露。
    /// 改为复用既有的 UserId 定向（那套判定已经到处都对了），零新字段。
    /// </summary>
    internal static async Task<List<int>?> RecipientsAsync(AppDbContext db, WikiTask task)
    {
        if (task.Visibility == "personal")
            return task.UserId is int owner ? [owner] : [];

        if (task.Visibility != "department") return null;   // public：广播

        var ids = await db.Users
            .Where(u => u.Department != null && u.Department.Name == task.TargetFolder)
            .Select(u => u.Id)
            .ToListAsync();

        // 发起人即使不在该部门（或被调走了）也该收到自己的任务通知
        if (task.UserId is int requester && !ids.Contains(requester)) ids.Add(requester);
        return ids;
    }

    internal static async Task NotifyCompletedAsync(NotificationService notify, AppDbContext db, WikiTask task)
    {
        const string title = "Wiki 生成完成";
        var message = $"项目 {task.ProjectName} 的文档已生成";
        var link = $"/wiki/{task.Id}";

        var recipients = await RecipientsAsync(db, task);
        if (recipients is null) { notify.Notify(title, message, link); return; }
        foreach (var uid in recipients) notify.Notify(title, message, link, userId: uid);
    }
}
