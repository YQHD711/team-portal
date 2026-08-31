using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class FlightTools
{
    private readonly FlightService _flight;
    private readonly FlightLogService _flightLog;
    public FlightTools(FlightService flight, FlightLogService flightLog) { _flight = flight; _flightLog = flightLog; }

    [McpServerTool(Name = "flight_list_batteries")]
    public async Task<object> ListBatteries() => await _flight.GetBatteries();
    [McpServerTool(Name = "flight_create_battery")]
    public async Task<object> CreateBattery(string number, string? health = null, string? notes = null) => await _flight.CreateBattery(number, health, DateTime.UtcNow, notes);
    [McpServerTool(Name = "flight_update_battery")]
    public async Task<bool> UpdateBattery(int id, string? number = null, string? health = null, string? notes = null) => await _flight.UpdateBattery(id, number, health, null, notes);
    [McpServerTool(Name = "flight_delete_battery")]
    public async Task<bool> DeleteBattery(int id) => await _flight.DeleteBattery(id);
    [McpServerTool(Name = "flight_list_incidents")]
    public async Task<object> ListIncidents(int page = 1, int pageSize = 50) => await _flight.GetIncidents(0, "admin", null, null, page, pageSize);
    [McpServerTool(Name = "flight_create_incident")]
    public async Task<object> CreateIncident(string type, string severity, string description, string? resolution = null, string? reportedBy = null) => await _flight.CreateIncident(type, severity, description, DateTime.UtcNow, resolution, reportedBy, 0, null);
    [McpServerTool(Name = "flight_update_incident")]
    public async Task<bool> UpdateIncident(int id, string? type = null, string? severity = null, string? description = null, string? resolution = null) => await _flight.UpdateIncident(id, type, severity, description, null, resolution);
    [McpServerTool(Name = "flight_delete_incident")]
    public async Task<bool> DeleteIncident(int id) => await _flight.DeleteIncident(id);
    [McpServerTool(Name = "flight_list_logs")]
    public async Task<object?> ListLogs() => await _flightLog.ListLogs();
    [McpServerTool(Name = "flight_parse_log")]
    public async Task<object?> ParseLog(string filename) => await _flightLog.ParseLog(filename);
}
