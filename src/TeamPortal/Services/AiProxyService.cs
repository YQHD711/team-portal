using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

/// <summary>
/// AI service — calls DeepSeek API directly (no Python dependency).
/// Also provides knowledge base RAG search.
/// </summary>
public class AiProxyService
{
    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly KnowledgeService _knowledge;

    public AiProxyService(HttpClient http, IConfiguration config, KnowledgeService knowledge)
    {
        _http = http;
        _knowledge = knowledge;
        _apiKey = config.GetValue<string>("AiService:DeepSeekKey") ?? "";
        _baseUrl = config.GetValue<string>("AiService:DeepSeekBaseUrl") ?? "https://api.deepseek.com";
    }

    public async Task<Stream?> ChatStream(string question)
    {
        if (string.IsNullOrEmpty(_apiKey)) return null;

        var payload = new
        {
            model = "deepseek-chat",
            messages = new[] { new { role = "user", content = question } },
            stream = true,
            max_tokens = 4096
        };

        var json = JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/v1/chat/completions")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("Authorization", $"Bearer {_apiKey}");

        var response = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode) return null;

        return await response.Content.ReadAsStreamAsync();
    }

    public async Task<object?> Search(string query)
    {
        // First, search local knowledge base
        var sources = new List<object>();
        var knowledgeDir = Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "knowledge");
        if (Directory.Exists(knowledgeDir))
        {
            var keywords = query.ToLower().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            foreach (var file in Directory.GetFiles(knowledgeDir, "*.md", SearchOption.AllDirectories).Take(50))
            {
                try
                {
                    var content = await File.ReadAllTextAsync(file);
                    var score = keywords.Sum(kw => content.ToLower().Split(kw).Length - 1);
                    if (score > 0)
                    {
                        sources.Add(new { path = Path.GetRelativePath(knowledgeDir, file).Replace('\\', '/'), snippet = content[..Math.Min(content.Length, 300)], score });
                    }
                }
                catch { /* skip */ }
            }
        }

        var sorted = sources.OrderByDescending(s => ((dynamic)s).score).Take(5).ToList();

        // Build RAG prompt
        var context = string.Join("\n\n---\n\n", sorted.Select(s =>
        {
            var d = (dynamic)s;
            return $"Source: {d.path}\n{d.snippet}";
        }));

        var ragPrompt = sorted.Count > 0
            ? $"根据以下参考资料回答问题。如果参考资料中没有相关信息，请直接说不知道。\n\n## 参考资料\n{context}\n\n## 问题\n{query}\n\n## 回答"
            : query;

        // Call DeepSeek if key is available
        string? answer = null;
        if (!string.IsNullOrEmpty(_apiKey))
        {
            try
            {
                var payload = new
                {
                    model = "deepseek-chat",
                    messages = new[] { new { role = "user", content = ragPrompt } },
                    max_tokens = 2048
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
            catch { /* ignore */ }
        }

        return new { sources = sorted, answer };
    }
}
