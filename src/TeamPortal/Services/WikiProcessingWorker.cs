using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;

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
                        notify.Notify("Wiki 生成完成", $"项目 {task.ProjectName} 的文档已生成", $"/wiki/{task.Id}");
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
}
