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
                    .Where(t => t.Status == "pending")
                    .OrderBy(t => t.CreatedAt)
                    .FirstOrDefaultAsync(stoppingToken);

                if (task != null)
                {
                    var log = scope.ServiceProvider.GetRequiredService<LogService>();
                    log.Info("wiki", $"Processing wiki task: {task.ProjectName}");
                    await generator.ProcessTask(task.Id);
                    if (task.Status == "completed")
                        log.Info("wiki", $"Wiki task completed: {task.ProjectName}", $"{{\"catalogDocs\":{task.CatalogJson?.Length ?? 0}}}");
                    else
                        log.Error("wiki", $"Wiki task failed: {task.ProjectName}", task.ErrorMessage);
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
