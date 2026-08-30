using System.Text;
using System.Text.Json;

namespace TeamPortal.Services;

public class FlightLogService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly string _logDir;

    public FlightLogService(HttpClient http, IConfiguration config)
    {
        _http = http;
        _config = config;
        _logDir = Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "flightlogs");
    }

    public async Task<object?> ListLogs()
    {
        Directory.CreateDirectory(_logDir);
        var logs = new List<object>();
        foreach (var f in Directory.GetFiles(_logDir, "*.tlog").Concat(Directory.GetFiles(_logDir, "*.bin")).OrderByDescending(File.GetLastWriteTime))
        {
            var info = new FileInfo(f);
            logs.Add(new { filename = info.Name, size = info.Length, modified = ((DateTimeOffset)info.LastWriteTimeUtc).ToUnixTimeSeconds() });
        }
        return new { logs };
    }

    public async Task<object?> ParseLog(string filename)
    {
        var filepath = Path.Combine(_logDir, filename);
        if (!File.Exists(filepath)) return null;

        // Try calling Python for detailed parsing
        var baseUrl = _config["AiService:BaseUrl"] ?? "http://localhost:9001";
        try
        {
            var json = JsonSerializer.Serialize(new { filename });
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await _http.PostAsync($"{baseUrl}/api/logs/parse", content);
            if (response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<object>(body);
            }
        }
        catch { /* Python not available — return basic info */ }

        var info = new FileInfo(filepath);
        return new
        {
            filename = info.Name,
            size = info.Length,
            messageCount = 0,
            maxAltitude = (double?)null,
            minAltitude = (double?)null,
            duration = (double?)null,
            altitudeSeries = Array.Empty<object>(),
            note = "pymavlink 未安装 — 仅显示文件基本信息。安装: pip install pymavlink"
        };
    }
}
