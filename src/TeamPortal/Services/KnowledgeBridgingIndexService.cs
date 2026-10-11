using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// P0-1 中英桥接索引：给英文知识库文档生成一行中文摘要 sidecar（<c>{原文}.zhidx.json</c>），
/// 让中文提问能命中英文原文（<see cref="KnowledgeSearchService"/> 把 sidecar 的中文内容并入原文索引）。
///
/// 调度与限流（规格）：并发 1、请求间隔 ≥500ms、失败重试 2 次后跳过并记日志、
/// 单次运行最多处理 <see cref="MaxDocsPerRun"/> 篇；增量判据是**文件 mtime**
/// （sidecar 不存在或比原文旧 → 需要处理），不额外加数据库字段。
/// AI 调用统一走 <see cref="AiClient"/>（不自拼 URL/请求体；不读已删除的 AI:DeepSeekKey）。
/// </summary>
public class KnowledgeBridgingIndexService
{
    public const int MaxDocsPerRun = 300;
    public const int RequestIntervalMs = 500;
    public const int MaxRetries = 2;          // 失败重试 2 次（首次 + 2 次重试 = 最多 3 次尝试）
    private const int MinSourceBytes = 200;   // 太小的文件不值得花 token

    private static readonly string[] BridgePatterns = { "*.md", "*.txt" };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string _basePath;
    private readonly ILogger<KnowledgeBridgingIndexService> _logger;
    private readonly LogService _log;
    private readonly object _statusLock = new();
    private int _running;

    public record BridgingStatus(bool Running, int Processed, int Total, int Failed,
        DateTime? LastRunAt, string? LastMessage);
    public record BridgingRunResult(bool Ok, string Message, int Processed, int Failed,
        int Pending, bool Truncated);

    private BridgingStatus _status = new(false, 0, 0, 0, null, null);

    public KnowledgeBridgingIndexService(IServiceScopeFactory scopeFactory, IConfiguration config,
        ILogger<KnowledgeBridgingIndexService> logger, LogService log)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _log = log;
        _basePath = config.GetValue<string>("Knowledge:BasePath")
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "knowledge");
    }

    public BridgingStatus Status() { lock (_statusLock) return _status; }

    /// <summary>手动触发（HTTP 入口）：立即返回是否启动成功，实际跑在后台，进度看 <see cref="Status"/>。</summary>
    public bool TryStart(bool force)
    {
        if (Interlocked.CompareExchange(ref _running, 1, 0) != 0) return false;
        _ = Task.Run(async () =>
        {
            try { await RunCoreAsync(force, CancellationToken.None); }
            catch (Exception ex) { _logger.LogError(ex, "Knowledge bridging index run failed"); }
            finally { Interlocked.Exchange(ref _running, 0); }
        });
        return true;
    }

    /// <summary>同步跑一轮（后台 worker 与测试用）。已有任务在跑时直接返回，不排队。</summary>
    public async Task<BridgingRunResult> RunAsync(bool force, CancellationToken ct = default)
    {
        if (Interlocked.CompareExchange(ref _running, 1, 0) != 0)
            return new BridgingRunResult(false, "已有一次桥接索引任务在运行", 0, 0, 0, false);
        try { return await RunCoreAsync(force, ct); }
        finally { Interlocked.Exchange(ref _running, 0); }
    }

    private async Task<BridgingRunResult> RunCoreAsync(bool force, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var ai = scope.ServiceProvider.GetRequiredService<AiClient>();
        var opt = await ai.ResolveAsync();
        if (!opt.IsConfigured)
            return Finish(false, "AI 未配置（AI:ApiKey 为空），跳过桥接索引");

        var candidates = CollectCandidates(force, out var pending);
        SetStatus(new BridgingStatus(true, 0, candidates.Count, 0, null, "正在生成中文摘要"));
        var processed = 0; var failed = 0;

        foreach (var file in candidates)
        {
            if (ct.IsCancellationRequested) break;
            var relPath = Path.GetRelativePath(_basePath, file).Replace('\\', '/');
            string? title = null; List<string>? keywords = null; string? summary = null;
            for (var attempt = 0; attempt <= MaxRetries && title is null; attempt++)
            {
                if (attempt > 0) await Task.Delay(RequestIntervalMs * attempt, ct);
                var parsed = await TryGenerateAsync(ai, opt, relPath, file);
                if (parsed is { } p) { (title, keywords, summary) = p; }
                else _logger.LogWarning("Bridging summary attempt {Attempt} failed: {Path}", attempt + 1, relPath);
            }

            if (title is null)
            {
                failed++;
                _log.Warn("ai", $"桥接索引：{relPath} 重试 {MaxRetries} 次仍失败，已跳过");
            }
            else
            {
                try
                {
                    KnowledgeBridge.WriteSidecarAtomic(KnowledgeBridge.SidecarPathFor(file),
                        KnowledgeBridge.BuildJson(relPath, title, keywords ?? [], summary ?? ""));
                    processed++;
                }
                catch (Exception ex)
                {
                    failed++;
                    _logger.LogError(ex, "Failed to write bridging sidecar for {Path}", relPath);
                }
            }

            SetStatus(new BridgingStatus(true, processed + failed, candidates.Count, failed, null, relPath));
            await Task.Delay(RequestIntervalMs, ct);   // 请求间隔 ≥500ms
        }

        var truncated = pending > candidates.Count;
        var message = $"处理 {processed} 篇、失败 {failed} 篇；待处理共 {pending} 篇"
                      + (truncated ? $"（本次已达单次上限 {MaxDocsPerRun} 篇）" : "");
        return Finish(true, message, processed, failed, pending, truncated);
    }

    private BridgingRunResult Finish(bool ok, string message, int processed = 0, int failed = 0,
        int pending = 0, bool truncated = false)
    {
        SetStatus(new BridgingStatus(false, processed, processed + failed, failed, DateTime.UtcNow, message));
        if (ok) _log.Info("ai", $"知识库中文桥接索引：{message}");
        else _log.Warn("ai", $"知识库中文桥接索引未执行：{message}");
        return new BridgingRunResult(ok, message, processed, failed, pending, truncated);
    }

    private void SetStatus(BridgingStatus status) { lock (_statusLock) _status = status; }

    /// <summary>挑出需要生成 sidecar 的英文文档（先按 mtime 过滤，再读正文判英文），最多 <see cref="MaxDocsPerRun"/> 篇。</summary>
    private List<string> CollectCandidates(bool force, out int pending)
    {
        var candidates = new List<string>();
        pending = 0;
        if (!Directory.Exists(_basePath)) return candidates;

        foreach (var pattern in BridgePatterns)
        {
            foreach (var file in Directory.EnumerateFiles(_basePath, pattern, SearchOption.AllDirectories))
            {
                try
                {
                    if (KnowledgeBridge.IsSidecar(file) || IsInsideHistory(file)) continue;
                    var info = new FileInfo(file);
                    if (info.Length < MinSourceBytes) continue;
                    if (!force && !NeedsBridge(file, info)) continue;
                    var text = File.ReadAllText(file);
                    if (!KnowledgeBridge.IsEnglishText(text)) continue;   // 中文文档不需要桥接
                    pending++;
                    if (candidates.Count < MaxDocsPerRun) candidates.Add(file);
                }
                catch (Exception ex) { _logger.LogWarning(ex, "Bridging scan skipped file: {File}", file); }
            }
        }
        candidates.Sort(StringComparer.Ordinal);
        return candidates;
    }

    private static bool NeedsBridge(string file, FileInfo info)
    {
        var sidecar = new FileInfo(KnowledgeBridge.SidecarPathFor(file));
        return !sidecar.Exists || sidecar.LastWriteTimeUtc < info.LastWriteTimeUtc;
    }

    private static bool IsInsideHistory(string file) =>
        file.Replace('\\', '/').Contains("/.history/", StringComparison.OrdinalIgnoreCase);

    private async Task<(string Title, List<string> Keywords, string Summary)?> TryGenerateAsync(
        AiClient ai, AiOptions opt, string relPath, string file)
    {
        try
        {
            var text = await File.ReadAllTextAsync(file);
            var messages = new object[]
            {
                new { role = "system", content = KnowledgeBridge.SummarySystemPrompt },
                new { role = "user", content = KnowledgeBridge.BuildUserPrompt(relPath, text) },
            };
            var payload = ai.BuildChatPayload(opt, messages, stream: false, maxTokens: 600, temperature: 0.2);
            var resp = await ai.SendAsync(ai.CreateChatRequest(opt, payload));
            if (!resp.IsSuccessStatusCode) return null;
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            return KnowledgeBridge.ParseSummary(AiClient.ExtractMessageContent(doc.RootElement));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bridging AI call failed: {Path}", relPath);
            return null;
        }
    }
}

