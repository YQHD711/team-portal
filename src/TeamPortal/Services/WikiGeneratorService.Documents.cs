using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace TeamPortal.Services;

/// <summary>
/// WikiGeneratorService 的文档生成部分：按目录批量生成文档、AI 自复审修复、以及手动触发更新。
/// </summary>
public partial class WikiGeneratorService
{
    // ════════════════════════════════════════
    //  Document Generation
    // ════════════════════════════════════════

    /// <summary>目录里可安全写入的叶节点（= 应当存在的文档集）。</summary>
    private List<CatalogItem> SafeLeaves() =>
        FlattenCatalog(ParseCatalog())
            .Where(i => i.Children is null or { Count: 0 })
            .Where(i => IsSafeCatalogPath(i.Path))
            .ToList();

    private async Task GenerateAllDocuments()
    {
        // 只处理安全路径：目录可能来自请求方的 customCatalogJson，含 ../ 的项 ToolWriteDoc 会拒绝，
        // 生成它纯属浪费 AI 调用（复审阶段也是同样过滤）
        var leaves = SafeLeaves();
        _logger.LogInformation("Generating {Count} documents for {Project}", leaves.Count, _projectName);

        var done = 0;
        _progress.Set(_currentTaskId, "documents", 0, leaves.Count, $"开始生成 {leaves.Count} 篇文档");
        using var semaphore = new SemaphoreSlim(_options.ParallelCount);
        var tasks = leaves.Select(async item =>
        {
            await semaphore.WaitAsync();
            try
            {
                await GenerateDocumentVerified(item);
                // Interlocked：文档是并行的，进度计数必须原子（也刻意不写库，见 WikiProgressTracker）
                var finished = Interlocked.Increment(ref done);
                _progress.Set(_currentTaskId, "documents", finished, leaves.Count, item.Title);
            }
            finally { semaphore.Release(); }
        });

        await Task.WhenAll(tasks);
    }

    /// <summary>
    /// 生成一篇文档并**校验它真的落盘了**。
    ///
    /// 为什么必须校验：AI 有可能只回一段文本而不调用 write_doc（迭代耗尽、模型跑偏、被截断），
    /// 此时 CallDeepSeekWithTools 正常返回、不抛异常，文档就"静默缺失"——任务照样算完成，
    /// 表现为「目录能点开但文档 404、知识库里也找不到」。所以这里核对文件，缺失就补一次
    /// 明确要求写文件的请求。
    /// </summary>
    private async Task GenerateDocumentVerified(CatalogItem item)
    {
        await GenerateDocument(item);
        if (DocumentExists(item)) return;

        _logger.LogWarning("Document not written by AI, retrying once: {Path}", item.Path);
        await GenerateDocument(item, emphasizeWrite: true);
        if (!DocumentExists(item))
            _logger.LogError("Document still missing after retry: {Path}", item.Path);
    }

    /// <summary>该目录项对应的知识库相对路径（唯一拼法，生成/校验/恢复都用它）。</summary>
    private string RelativeDocPath(CatalogItem item) =>
        $"{_targetFolder}/{_projectName}/{item.Path}.md".Replace("//", "/");

    /// <summary>该目录项对应的知识库文件是否已存在。</summary>
    private bool DocumentExists(CatalogItem item)
    {
        if (!IsSafeCatalogPath(item.Path)) return false;
        return _knowledge.FileExists(RelativeDocPath(item));
    }

    /// <summary>本次生成结束后仍缺失的文档路径（供上游据此判定成功/失败）。</summary>
    private List<string> MissingDocuments() => FindMissingDocuments(SafeLeaves(), DocumentExists);

    /// <summary>纯函数便于单测：挑出尚未落盘的目录项。</summary>
    internal static List<string> FindMissingDocuments(IEnumerable<CatalogItem> leaves, Func<CatalogItem, bool> exists) =>
        leaves.Where(i => !exists(i)).Select(i => i.Path).ToList();

    /// <summary>Review and fix all generated documents — mermaid syntax, markdown issues, etc.</summary>
    private async Task ReviewAllDocuments()
    {
        var leaves = FlattenCatalog(ParseCatalog()).Where(i => i.Children is null or { Count: 0 }).ToList();
        _logger.LogInformation("Reviewing {Count} documents for {Project}", leaves.Count, _projectName);

        _progress.Set(_currentTaskId, "reviewing", 0, leaves.Count, "正在检查修正文档格式");
        var reviewedCount = 0;
        foreach (var item in leaves)
        {
            try
            {
                _progress.Set(_currentTaskId, "reviewing", reviewedCount, leaves.Count, item.Title);
                // 目录清单可来自请求方的 customCatalogJson,含 ../ 的项直接跳过(否则可覆盖他部门文档)
                if (!IsSafeCatalogPath(item.Path))
                {
                    _logger.LogWarning("Skipped unsafe catalog path during review: {Path}", item.Path);
                    continue;
                }
                var kbPath = $"{_targetFolder}/{_projectName}/{item.Path}.md".Replace("//", "/");
                var content = _knowledge.GetContent(kbPath);
                if (string.IsNullOrWhiteSpace(content)) continue;

                var reviewPrompt = $@"你是技术文档审查专家。检查以下文档问题并修复：

## 检查清单
1. Mermaid 图表语法是否正确（节点文本中的 ()、[]、{{}} 是否用双引号包裹）
2. Markdown 格式是否正确（标题层级、代码块语言标注、链接有效性）
3. 中文表述是否通顺、是否有明显错误
4. 代码块是否标注了语言（```python, ```csharp 等）

## 要求
- **只修复问题，不要重写整个文档**
- 如果文档没有问题，返回原文
- Mermaid 节点文本中的 () [] {{}} 必须用双引号包裹，如 A[""text()""]

## 原始文档
{content}

请返回修复后的完整 Markdown 文档：";

                var system = "你是一个文档审查专家。只修复问题，不重写。直接返回修复后的 Markdown 文档。";
                var aiKey = await GetApiKey();
                var aiUrl = await GetBaseUrl();

                var payload = new
                {
                    model = "deepseek-v4-flash",
                    messages = new object[] {
                        new { role = "system", content = system },
                        new { role = "user", content = reviewPrompt }
                    },
                    temperature = 0.2,
                    max_tokens = 16384
                };

                var json = JsonSerializer.Serialize(payload, JsonOpts);
                var req = new HttpRequestMessage(HttpMethod.Post, $"{aiUrl}/v1/chat/completions")
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("Authorization", $"Bearer {aiKey}");

                var resp = await _http.SendAsync(req);
                if (!resp.IsSuccessStatusCode) continue;

                var body = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var reviewed = doc.RootElement.GetProperty("choices")[0]
                    .GetProperty("message").GetProperty("content").GetString();

                if (!string.IsNullOrWhiteSpace(reviewed) && reviewed.Trim() != content.Trim())
                {
                    _knowledge.WriteFile(kbPath, reviewed);
                    _logger.LogInformation("Doc reviewed & fixed: {Path}", kbPath);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Review failed for {Path}", item.Path);
            }
            finally
            {
                // continue 也会走这里：跳过/失败的条目同样推进计数，进度条才单调
                reviewedCount++;
                _progress.Set(_currentTaskId, "reviewing", reviewedCount, leaves.Count, item.Title);
            }
        }
    }

    /// <summary>Public entry for manual update — re-run review on a completed task.</summary>
    public async Task<bool> UpdateDocuments(string taskId)
    {
        var task = await _db.WikiTasks.FindAsync(taskId);
        if (task is null || task.Status != "completed") return false;

        _currentTaskId = task.Id;
        _projectName = task.ProjectName;
        _targetFolder = task.TargetFolder;
        _catalogJson = task.CatalogJson;
        _complexityScore = 3; // moderate for review

        try
        {
            task.Status = "reviewing"; await _db.SaveChangesAsync();
            await ReviewAllDocuments();
            task.Status = "completed";
            task.ErrorMessage = null;
            await _db.SaveChangesAsync();
            _logger.LogInformation("Wiki task updated: {Project}", task.ProjectName);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Wiki update failed: {Project}", task.ProjectName);
            task.Status = "completed"; // revert to completed
            task.ErrorMessage = $"Update failed: {ex.Message}";
            await _db.SaveChangesAsync();
            return false;
        }
    }

    private async Task GenerateDocument(CatalogItem item, bool emphasizeWrite = false)
    {
        var docPath = $"{item.Path}";
        var docTitle = item.Title;

        var complexityHint = _complexityScore <= 2
            ? "\n\n## 本项目为简单项目\n- 文档应该简洁精炼，不要过度解释显而易见的代码\n- 每个要点 1-2 段即可，避免冗长的背景介绍\n- Mermaid 图可选（仅在确实有助于理解时才画）\n- 重点放在实际使用方法和调用示例上"
            : _complexityScore >= 4
            ? "\n\n## 本项目为复杂项目\n- 需要深入分析架构设计和模块间交互\n- 每个模块的职责、数据流、错误处理都应该覆盖\n- 需要详细的 Mermaid 图来辅助理解\n- 代码示例应涵盖主要的 API 和关键路径"
            : "";

        var systemPrompt = $@"你是一个资深技术文档撰写专家。基于项目源代码撰写 Wiki 文档。

## 可用工具
- list_files(path): 列出目录
- read_file(path): 读取文件内容
- search_code(pattern, path): 搜索代码
- write_doc(path, content): 写入文档（必须调用！）
{complexityHint}

## 文档要求
1. 标题用 H1 (# )，必须与指定标题一致
2. 包含架构概述、核心流程、关键代码片段
3. {(_complexityScore <= 2 ? "如果有助于理解，可以包含一个 Mermaid 图" : "至少包含一个 Mermaid 流程图或时序图")}（Mermaid 节点文本中的括号、方括号等特殊字符需要用双引号包裹，例如 A[""函数名()""] 这样写）
4. 所有信息必须基于实际代码
5. 写中文文档，但保持代码标识符原文
6. 代码示例加语言标注 ```python, ```csharp 等
7. **文件引用链接**: 引用源码时使用格式 [{{path}}](/wiki/{_currentTaskId}/blob/{{path}})，点击可查看源码
8. 最后必须调用 write_doc 写入文档";

        var userMessage = $@"请撰写文档: **{docTitle}**

## 项目信息
- 项目: {_projectName}
- 类型: {DetectProjectType()}
- 任务ID: {_currentTaskId}

## 文档路径
- 路径: {docPath}
- 标题: {docTitle}

## 文件引用格式
源码引用链接: `/wiki/{_currentTaskId}/blob/{{文件路径}}`
使用 Markdown 链接: `[查看源码](/wiki/{_currentTaskId}/blob/src/main.py)`

## 指示
1. 先用 list_files 和 search_code 找到相关文件
2. 用 read_file 阅读关键源文件
3. 基于代码撰写完整文档
4. **重要**: 在文档中提及源码文件时，使用文件引用链接格式
5. 用 write_doc(path: ""{docPath}"", content: <你的 Markdown 文档>) 写入
{(emphasizeWrite ? "\n\n注意：上一次生成没有调用 write_doc，文档并未保存。这一次必须真正调用 write_doc 工具写入文件，不要只在回复里输出内容。" : "")}

请开始撰写。";

        var tools = new List<ToolDef>
        {
            new("list_files", "List directory contents.", new { path = new { type = "string", description = "Directory path" } }),
            new("read_file", "Read file content.", new { path = new { type = "string", description = "File path" } }),
            new("search_code", "Search code.", new { pattern = new { type = "string" }, path = new { type = "string" } }),
            new("write_doc", "Write document. MUST call this.", new { path = new { type = "string", description = "Document path (without .md)" }, content = new { type = "string", description = "Full Markdown content" } }),
        };

        await CallDeepSeekWithTools(systemPrompt, userMessage, tools, $"Doc:{docTitle}", _currentModel);
    }

    private static List<CatalogItem> FlattenCatalog(List<CatalogItem> items)
    {
        var result = new List<CatalogItem>();
        foreach (var item in items) { result.Add(item); if (item.Children?.Count > 0) result.AddRange(FlattenCatalog(item.Children)); }
        return result;
    }
}
