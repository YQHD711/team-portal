using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的翻译部分：克隆仓库、批量翻译 Markdown 文档为中文（英文原文镜像保留）。
/// </summary>
public partial class WikiGeneratorService
{
    /// <summary>Translate all markdown files in a cloned repo to Chinese.</summary>
    public async Task ProcessTranslateTask(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null) return;

        try
        {
            _currentTaskId = task.Id;
            _projectName = task.ProjectName;
            _targetFolder = task.TargetFolder;

            task.Status = "preparing"; await _db.SaveChangesAsync();
            var baseDir = Path.Combine(Path.GetTempPath(), "teamportal-wiki", $"{task.Id}-{DateTime.UtcNow:yyyyMMddHHmmss}");
            Directory.CreateDirectory(baseDir);
            var cloneDir = Path.Combine(baseDir, "repo");

            // Clone the repo
            task.Status = "cloning"; await _db.SaveChangesAsync();
            var psi = new System.Diagnostics.ProcessStartInfo("git", $"clone --depth 1 {task.SourceUrl} {cloneDir}")
            { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            var proc = System.Diagnostics.Process.Start(psi)!;
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                var err = await proc.StandardError.ReadToEndAsync();
                throw new InvalidOperationException($"Git clone failed: {err[..Math.Min(200, err.Length)]}");
            }

            // Find all .md files
            var mdFiles = Directory.GetFiles(cloneDir, "*.md", SearchOption.AllDirectories)
                .Where(f => !f.Replace('\\', '/').Contains("/.git/"))
                .Select(f => new { FullPath = f, Relative = Path.GetRelativePath(cloneDir, f).Replace('\\', '/') })
                .ToList();

            task.Status = "translating"; await _db.SaveChangesAsync();
            var total = mdFiles.Count;
            var done = 0;
            var aiKey = await GetApiKey();
            var aiUrl = await GetBaseUrl();
            if (string.IsNullOrEmpty(aiKey)) throw new InvalidOperationException("AI API key not configured");

            var catalog = new List<object>();

            foreach (var file in mdFiles)
            {
                try
                {
                    var content = await File.ReadAllTextAsync(file.FullPath);
                    if (string.IsNullOrWhiteSpace(content) || content.Length < 50) continue;

                    // Save original English version as mirror
                    var enPath = $"{_targetFolder}/{_projectName}_EN/{file.Relative}".Replace("//", "/");
                    _knowledge.WriteFile(enPath, content);

                    // Translate and save Chinese version
                    var translated = await TranslateText(content, aiKey, aiUrl, _http);
                    if (!string.IsNullOrWhiteSpace(translated))
                    {
                        var zhPath = $"{_targetFolder}/{_projectName}/{file.Relative}".Replace("//", "/");
                        _knowledge.WriteFile(zhPath, translated);
                    }

                    catalog.Add(new { path = file.Relative.Replace(".md", ""), title = Path.GetFileNameWithoutExtension(file.Relative) });
                    done++;
                    _logger.LogInformation("Translate [{Done}/{Total}]: {File}", done, total, file.Relative);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Translation failed for {File}", file.Relative);
                }
            }

            // 复制非 .md 资源(images/、css/、assets/ 等)到知识库,保留相对路径
            var resourceFiles = Directory.GetFiles(cloneDir, "*", SearchOption.AllDirectories)
                .Where(f =>
                {
                    var rel = Path.GetRelativePath(cloneDir, f).Replace('\\', '/');
                    return !rel.Contains("/.git/") && !rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase);
                });
            foreach (var rf in resourceFiles)
            {
                try
                {
                    var relPath = Path.GetRelativePath(cloneDir, rf).Replace('\\', '/');
                    var data = await File.ReadAllBytesAsync(rf);
                    _knowledge.WriteFile($"{_targetFolder}/{_projectName}/{relPath}", data);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to copy wiki resource: {File}", rf);
                }
            }

            task.CatalogJson = System.Text.Json.JsonSerializer.Serialize(catalog);
            task.Status = done > 0 ? "completed" : "failed";
            task.ErrorMessage = done == 0 ? $"All {total} pages failed to translate" : null;
            task.CompletedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            _logger.LogInformation("Translation {Status}: {Done}/{Total} pages", task.Status, done, total);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Translation task {TaskId} failed", taskId);
            task.Status = "failed"; task.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();
        }
    }

    private static async Task<string?> TranslateText(string content, string apiKey, string baseUrl, HttpClient http)
    {
        var prompt = $@"将以下英文技术文档翻译为简体中文。要求：
1. 准确翻译技术术语，保持专业性
2. 保留 Markdown 格式、代码块、链接、图片引用不变
3. 中文表述流畅自然，符合技术文档风格
4. 如果有 YAML front matter（---包裹的内容），保留不变

原文：
{content[..Math.Min(content.Length, 8000)]}";

        var payload = new
        {
            model = "deepseek-v4-flash",
            messages = new[] { new { role = "user", content = prompt } },
            temperature = 0.1, max_tokens = 8192
        };
        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
        { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.Add("Authorization", $"Bearer {apiKey}");

        var resp = await http.SendAsync(req);
        if (!resp.IsSuccessStatusCode) return null;
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
    }
}
