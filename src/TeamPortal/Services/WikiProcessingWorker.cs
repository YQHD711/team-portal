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
                        if (task.Type == "translate")
                            await generator.ProcessTranslateTask(task.Id);
                        else
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
                        notify.Notify(task.Type == "translate" ? "文档翻译完成" : "Wiki 生成完成",
                            task.Type == "translate" ? $"项目 {task.ProjectName} 的文档已翻译" : $"项目 {task.ProjectName} 的文档已生成",
                            $"/wiki/{task.Id}");
                    }
                    else
                    {
                        log.Error("wiki", $"Task failed: {task.ProjectName}", task.ErrorMessage);
                        notify.Notify(task.Type == "translate" ? "文档翻译失败" : "Wiki 生成失败",
                            $"{task.ProjectName}: {task.ErrorMessage}", userId: task.UserId);
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
