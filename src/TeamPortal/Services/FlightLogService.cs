using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

public class FlightLogService
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public FlightLogService(HttpClient http, IConfiguration config)
    {
        _http = http;
        _baseUrl = config.GetValue<string>("AiService:BaseUrl") ?? "http://localhost:9001";
    }

    public async Task<object?> ListLogs()
    {
        var response = await _http.GetAsync($"{_baseUrl}/api/logs/list");
        if (!response.IsSuccessStatusCode) return null;

        var body = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<object>(body);
    }

    public async Task<object?> ParseLog(string filename)
    {
        var json = JsonSerializer.Serialize(new { filename });
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _http.PostAsync($"{_baseUrl}/api/logs/parse", content);
        if (!response.IsSuccessStatusCode) return null;

        var body = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<object>(body);
    }
}
