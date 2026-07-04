using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

public class AiProxyService
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public AiProxyService(HttpClient http, IConfiguration config)
    {
        _http = http;
        _baseUrl = config.GetValue<string>("AiService:BaseUrl") ?? "http://localhost:9001";
    }

    public async Task<Stream?> ChatStream(string question)
    {
        var json = JsonSerializer.Serialize(new { question });
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _http.PostAsync($"{_baseUrl}/api/ai/chat", content);
        if (!response.IsSuccessStatusCode) return null;

        return await response.Content.ReadAsStreamAsync();
    }

    public async Task<object?> Search(string query)
    {
        var json = JsonSerializer.Serialize(new { query });
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _http.PostAsync($"{_baseUrl}/api/ai/search", content);
        if (!response.IsSuccessStatusCode) return null;

        var body = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<object>(body);
    }
}
