using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 飞行/事故工具。HTTP 侧电池与事故的写操作判 IsStaff,事故列表按调用者角色/部门过滤;
/// 旧实现恒以 "admin" 身份查询事故列表,导致任何成员都能读到全队事故记录,这里已改为取真实身份。
/// </summary>
[McpServerToolType]
public class FlightTools
{
    private readonly FlightService _flight;
    private readonly FlightLogService _flightLog;
    private readonly IHttpContextAccessor _http;
    public FlightTools(FlightService flight, FlightLogService flightLog, IHttpContextAccessor http)
    { _flight = flight; _flightLog = flightLog; _http = http; }

    [McpServerTool(Name = "flight_list_batteries")]
    public async Task<object> ListBatteries() => await _flight.GetBatteries();
    [McpServerTool(Name = "flight_create_battery")]
    public async Task<object> CreateBattery(string number, string? health = null, string? notes = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _flight.CreateBattery(number, health, DateTime.UtcNow, notes);
    [McpServerTool(Name = "flight_update_battery")]
    public async Task<object> UpdateBattery(int id, string? number = null, string? health = null, string? notes = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _flight.UpdateBattery(id, number, health, null, notes);
    [McpServerTool(Name = "flight_delete_battery")]
    public async Task<object> DeleteBattery(int id) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _flight.DeleteBattery(id);

    [McpServerTool(Name = "flight_list_incidents")]
    public async Task<object> ListIncidents(int page = 1, int pageSize = 50)
        => await _flight.GetIncidents(McpAuth.UserId(_http), McpAuth.Role(_http), McpAuth.Department(_http), null, page, pageSize);
    [McpServerTool(Name = "flight_create_incident")]
    public async Task<object> CreateIncident(string type, string severity, string description, string? resolution = null, string? reportedBy = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _flight.CreateIncident(type, severity, description, DateTime.UtcNow, resolution, reportedBy, 0, null);
    [McpServerTool(Name = "flight_update_incident")]
    public async Task<object> UpdateIncident(int id, string? type = null, string? severity = null, string? description = null, string? resolution = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _flight.UpdateIncident(id, type, severity, description, null, resolution);
    [McpServerTool(Name = "flight_delete_incident")]
    public async Task<object> DeleteIncident(int id) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _flight.DeleteIncident(id);

    [McpServerTool(Name = "flight_list_logs")]
    public async Task<object?> ListLogs() => await _flightLog.ListLogs();
    [McpServerTool(Name = "flight_download_log")]
    public async Task<object?> DownloadLog(string filename)
    {
        var file = _flightLog.GetFile(filename);
        if (file is null || file.Value.Bytes is null) return null;
        return new { filename, size = file.Value.Bytes.Length };
    }
}
