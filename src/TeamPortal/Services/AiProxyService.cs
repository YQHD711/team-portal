using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// AI service — DeepSeek V4 Pro with knowledge base RAG.
/// Searches local knowledge, builds context, uses aviation-specific system prompt.
/// </summary>
public class AiProxyService
{
    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly string _knowledgeDir;

    private const string SystemPrompt = """
        你是"雏鹰之翼"航模队的AI助手。你的职责是帮助队员解答问题、提供指导。

        ## 核心规则
        1. 优先基于知识库中的资料回答问题，引用来源
        2. 如果知识库没有相关信息，可以基于你的知识回答，但要说明"以下为通用知识，仅供参考"
        3. 回答要简洁实用，适合航模队员阅读
        4. 涉及技术参数时要准确，不确定的请说明
        5. 使用中文回答，保持友好专业的语气

        ## 航模相关知识领域
        - 飞行原理与空气动力学基础
        - 航模组装、调试与维修
        - 遥控器设置与飞行技巧
        - 电池、电机、电调选型与维护
        - 竞赛规则（CUADC等）
        - 安全规范与应急处理
        - 工具使用与工作台管理

        ## 回答格式
        - 先给出直接答案
        - 必要时补充详细说明
        - 如有参考资料，标注来源
        """;

    public AiProxyService(HttpClient http, IConfiguration config, KnowledgeService knowledge)
    {
        _http = http;
        _apiKey = config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        _baseUrl = config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
        _knowledgeDir = Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "knowledge");
    }

    /// <summary>
    /// Chat with RAG — searches knowledge base and streams answer via SSE.
    /// </summary>
    public async Task<Stream?> ChatStream(string question)
    {
        if (string.IsNullOrEmpty(_apiKey)) return null;

        // 1. Search knowledge base
        var sources = SearchKnowledge(question);
        var context = BuildContext(sources);

        // 2. Build messages
        var messages = new List<object>
        {
            new { role = "system", content = SystemPrompt },
        };

        if (!string.IsNullOrEmpty(context))
        {
            messages.Add(new { role = "system", content = $"## 知识库参考资料\n{context}" });
        }

        messages.Add(new { role = "user", content = question });

        // 3. Call DeepSeek V4 Pro
        var payload = new
        {
            model = "deepseek-v4-pro",
            messages,
            stream = true,
            temperature = 1.0,
            top_p = 1.0,
            max_tokens = 4096,
            extra_body = new { thinking_mode = "non-thinking" }
        };

        var json = JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/v1/chat/completions")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("Authorization", $"Bearer {_apiKey}");

        var response = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        return response.IsSuccessStatusCode ? await response.Content.ReadAsStreamAsync() : null;
    }

    /// <summary>
    /// Dedicated search endpoint with RAG answer.
    /// </summary>
    public async Task<object?> Search(string query)
    {
        var sources = SearchKnowledge(query);
        var context = BuildContext(sources);

        string? answer = null;
        if (!string.IsNullOrEmpty(_apiKey))
        {
            try
            {
                var messages = new List<object>
                {
                    new { role = "system", content = SystemPrompt },
                };

                var ragPrompt = sources.Count > 0
                    ? $"根据以下参考资料回答问题。\n\n## 参考资料\n{context}\n\n## 问题\n{query}"
                    : query;

                messages.Add(new { role = "user", content = ragPrompt });

                var payload = new
                {
                    model = "deepseek-v4-pro",
                    messages,
                    temperature = 1.0,
                    top_p = 1.0,
                    max_tokens = 4096,
                    extra_body = new { thinking_mode = "non-thinking" }
                };

                var json = JsonSerializer.Serialize(payload);
                var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/v1/chat/completions")
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("Authorization", $"Bearer {_apiKey}");

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

        return new { sources = sources.Select(s => new { s.Path, s.Snippet, s.Score }), answer };
    }

    /// <summary>
    /// Simple keyword + substring search over knowledge base .md files.
    /// </summary>
    private List<KbSource> SearchKnowledge(string query)
    {
        var results = new List<KbSource>();
        if (!Directory.Exists(_knowledgeDir)) return results;

        var q = query.ToLower();
        var keywords = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (keywords.Length == 0) keywords = new[] { q };

        foreach (var file in Directory.GetFiles(_knowledgeDir, "*.md", SearchOption.AllDirectories).Take(100))
        {
            try
            {
                var content = File.ReadAllText(file);
                var fn = Path.GetFileNameWithoutExtension(file).ToLower();
                var body = content.ToLower();
                var score = keywords.Sum(kw =>
                    (body.Contains(kw) ? 10 : 0) +
                    (fn.Contains(kw) ? 5 : 0) +
                    body.Split(kw).Length - 1
                );
                if (score > 0)
                {
                    results.Add(new KbSource
                    {
                        Path = Path.GetRelativePath(_knowledgeDir, file).Replace('\\', '/'),
                        Snippet = content.Length > 800 ? content[..800] + "\n...(truncated)" : content,
                        Score = score
                    });
                }
            }
            catch { }
        }

        return results.OrderByDescending(r => r.Score).Take(5).ToList();
    }

    private static string BuildContext(List<KbSource> sources)
    {
        if (sources.Count == 0) return "";
        return string.Join("\n\n---\n\n", sources.Select(s =>
            $"📄 来源: {s.Path}\n{s.Snippet}"));
    }

    private class KbSource
    {
        public string Path { get; set; } = "";
        public string Snippet { get; set; } = "";
        public int Score { get; set; }
    }
}
