using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// AI service — DeepSeek V4 Pro with knowledge base RAG.
/// Uses TF-IDF indexed search for fast, relevant knowledge retrieval.
/// </summary>
public class AiProxyService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly SettingsService _settings;
    private readonly KnowledgeSearchService _search;

    /// <summary>
    /// 内置默认提示词。前端是纯文本渲染（whitespace-pre-wrap），所以这里明确要求模型不要输出
    /// Markdown 装饰与 emoji —— 否则 **加粗**、## 标题、--- 分割线会原样显示，看起来全是符号。
    /// 管理员可在「系统设置 → AI 服务 → AI:SystemPrompt」整体替换。
    /// </summary>
    internal const string DefaultSystemPrompt = """
        你是"雏鹰之翼"航模队的内部 AI 助手，为队员提供技术支持和知识查询服务。

        身份：航模队的技术顾问，熟悉航模设计、制作、飞行全流程，涵盖空气动力学、电子工程、材料科学、竞赛规则等领域。

        规则：
        1. 优先使用知识库中的队内资料作答，并在结尾用「来源：文件名」注明出处
        2. 知识库没有相关内容时可用通用知识回答，但必须说明「以下信息来自通用知识，请以队内最新规范为准」
        3. 回答精准务实、避免冗长，让队员能直接照着做
        4. 技术参数与安全规范必须严谨，不确定的信息要明确说明
        5. 使用中文，语气专业而亲切，像资深队员在指导新人

        输出格式（重要，务必遵守）：
        - 直接输出纯文本，不要任何 Markdown 装饰：不用星号加粗、不用井号做标题、不用横线做分割、不用引用块、不要表格
        - 不要输出 emoji 或装饰性小图标、符号
        - 需要分点时用「1. 2. 3.」或「- 」的简单列表，最多一层；能用一两段话讲清楚就不要列表
        - 先给结论，再给必要的说明
        """;

    /// <summary>取生效的提示词：管理员配置优先，留空则用内置默认。</summary>
    internal static string SystemPromptOrDefault(string? configured) =>
        string.IsNullOrWhiteSpace(configured) ? DefaultSystemPrompt : configured.Trim();

    private async Task<string> ResolveSystemPrompt() =>
        SystemPromptOrDefault(await _settings.Get("AI:SystemPrompt"));

    public AiProxyService(HttpClient http, IConfiguration config, SettingsService settings, KnowledgeSearchService search)
    {
        _http = http;
        _config = config;
        _settings = settings;
        _search = search;
    }

    /// <summary>调用者身份,用于把知识库检索限制在其有权查看的范围内(跨部门/他人私人 wiki 不参与检索)。</summary>
    public readonly record struct SearchScope(string? Role, string? Department, int UserId);

    public async Task<Stream?> ChatStream(string question, SearchScope scope, List<(string role, string content)>? history = null)
    {
        var apiKey = await _settings.Get("AI:DeepSeekKey");
        if (string.IsNullOrEmpty(apiKey)) apiKey = _config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        if (string.IsNullOrEmpty(apiKey)) return null;

        var results = _search.Search(question, topK: 8, scope.Role, scope.Department, scope.UserId);
        // Filter: only include results with meaningful TF-IDF score (>5% of top score)
        var topScore = results.FirstOrDefault()?.Score ?? 0;
        var relevant = results.Where(r => r.Score >= topScore * 0.05).Take(5).ToList();
        var context = BuildContext(relevant);

        var messages = new List<object> { new { role = "system", content = await ResolveSystemPrompt() } };

        if (history != null && history.Count > 0)
            foreach (var (role, content) in history)
                messages.Add(new { role, content });

        if (!string.IsNullOrEmpty(context))
        {
            messages.Add(new { role = "system", content = $@"知识库参考资料（按相关度排序）：
请优先使用这些资料回答；与问题无关的直接忽略；若都不相关则基于通用知识回答并注明。

{context}" });
        }

        messages.Add(new { role = "user", content = question });

        var modelName = await _settings.Get("AI:ModelName", "deepseek-chat");
        var baseUrl = await _settings.Get("AI:DeepSeekBaseUrl", "https://api.deepseek.com");
        var temperature = await _settings.GetDouble("AI:Temperature", 1.0);

        var payload = new
        {
            model = modelName, messages, stream = true, temperature,
            top_p = 1.0, max_tokens = 4096,
            extra_body = new { thinking_mode = "non-thinking" }
        };

        var json = JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
        { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.Add("Authorization", $"Bearer {apiKey}");

        var response = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        return response.IsSuccessStatusCode ? await response.Content.ReadAsStreamAsync() : null;
    }

    public async Task<object?> Search(string query, SearchScope scope)
    {
        var results = _search.Search(query, topK: 5, scope.Role, scope.Department, scope.UserId);
        var context = BuildContext(results);

        string? answer = null;
        var apiKey = await _settings.Get("AI:DeepSeekKey");
        if (string.IsNullOrEmpty(apiKey)) apiKey = _config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        if (!string.IsNullOrEmpty(apiKey))
        {
            try
            {
                var messages = new List<object> { new { role = "system", content = await ResolveSystemPrompt() } };
                var ragPrompt = results.Count > 0
                    ? $"根据以下参考资料回答问题。\n\n参考资料：\n{context}\n\n问题：{query}"
                    : query;
                messages.Add(new { role = "user", content = ragPrompt });

                var modelName = await _settings.Get("AI:ModelName", "deepseek-chat");
                var baseUrl = await _settings.Get("AI:DeepSeekBaseUrl", "https://api.deepseek.com");
                var payload = new
                {
                    model = modelName, messages, temperature = 1.0, top_p = 1.0, max_tokens = 4096,
                    extra_body = new { thinking_mode = "non-thinking" }
                };

                var json = JsonSerializer.Serialize(payload);
                var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
                { Content = new StringContent(json, Encoding.UTF8, "application/json") };
                req.Headers.Add("Authorization", $"Bearer {apiKey}");

                var resp = await _http.SendAsync(req);
                if (resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(body);
                    answer = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
                }
            }
            catch { }
        }

        return new { sources = results.Select(r => new { r.Path, r.Snippet, r.Score }), answer };
    }

    /// <summary>拼装知识库上下文。刻意不用 emoji/## 装饰：这些符号会被模型照抄进回答里。</summary>
    internal static string BuildContext(List<KbResult> sources)
    {
        if (sources.Count == 0) return "";
        return string.Join("\n\n", sources.Select(s => $"来源：{s.Path}（相关度 {s.Score:F2}）\n{s.Snippet}"));
    }
}
