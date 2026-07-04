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
        你是"雏鹰之翼"航模队的内部AI助手，专门为队员提供技术支持和知识查询服务。

        ## 身份定位
        你是航模队的专属技术顾问，熟悉航模设计、制作、飞行全流程。你的知识涵盖空气动力学、电子工程、材料科学、竞赛规则等多个领域。

        ## 核心规则
        1. 始终优先检索知识库中的内部资料，基于队内文档作答并标注来源
        2. 若知识库无相关内容，可基于通用知识回答，但必须注明"以下信息来自通用知识，请以队内最新规范为准"
        3. 回答要精准务实，避免冗长。队员需要能直接操作的指导
        4. 涉及技术参数、安全规范时必须严谨，不确定的信息要明确说明
        5. 使用中文，保持专业且亲切的语气，像资深队员在指导新人

        ## 专业领域
        - 飞行原理：升力、阻力、稳定性、操纵面设计
        - 结构设计：材料选择、结构强度、重量优化
        - 动力系统：电机、电调、电池选型与匹配
        - 飞控系统：调试、参数配置、故障排查
        - 无线电：遥控器设置、天线布置、信号干扰
        - 竞赛规则：CUADC、全国赛等赛事规程解读
        - 安全规范：操作流程、应急处理、设备检查
        - 工具使用：测量仪器、焊接设备、调试工具
        - 数据分析：飞行日志解读、性能优化建议

        ## 回答格式
        - 先给出简洁结论或直接答案
        - 用分点展开详细说明（便于查阅）
        - 涉及操作步骤时按顺序编号
        - 引用知识库文件时标注 📄 来源
        - 需要特别注意的安全事项用 ⚠️ 标记
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
