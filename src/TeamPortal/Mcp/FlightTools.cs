using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 飞行/事故工具。HTTP 侧电池与事故的写操作判 IsStaff,事故列表按调用者角色/部门过滤;
/// 旧实现恒以 "admin" 身份查询事故列表,导致任何成员都能读到全队事故记录,这里已改为取真实身份。
/// 写操作补 OperationLog 审计。
/// </summary>
[McpServerToolType]
public class FlightTools
{
    private readonly FlightService _flight;
    private readonly IHttpContextAccessor _http;
    private readonly LogService? _log;
    public FlightTools(FlightService flight, IHttpContextAccessor http, LogService? log = null)
    { _flight = flight; _http = http; _log = log; }

    private void Audit(string action, string targetType, int id, object data)
        => _log?.Audit(action, McpAuth.UserName(_http), targetType: targetType, targetId: id.ToString(),
            data: data, ipAddress: McpAuth.ClientIp(_http), userId: McpAuth.UserId(_http));

    [McpServerTool(Name = "flight_list_batteries")]
    public async Task<object> ListBatteries() => await _flight.GetBatteries();

    [McpServerTool(Name = "flight_create_battery")]
    public async Task<object> CreateBattery(string number, string? health = null, string? notes = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var b = await _flight.CreateBattery(number, health, DateTime.UtcNow, notes);
        Audit("create", "battery", b.Id, new { via = "mcp", number, health });
        return b;
    }

    [McpServerTool(Name = "flight_update_battery")]
    public async Task<object> UpdateBattery(int id, string? number = null, string? health = null, string? notes = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var ok = await _flight.UpdateBattery(id, number, health, null, notes);
        Audit("update", "battery", id, new { via = "mcp", success = ok });
        return ok;
    }

    [McpServerTool(Name = "flight_delete_battery")]
    public async Task<object> DeleteBattery(int id)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var ok = await _flight.DeleteBattery(id);
        Audit("delete", "battery", id, new { via = "mcp", success = ok });
        return ok;
    }

    [McpServerTool(Name = "flight_list_incidents")]
    public async Task<object> ListIncidents(int page = 1, int pageSize = 50)
        => await _flight.GetIncidents(McpAuth.UserId(_http), McpAuth.Role(_http), McpAuth.Department(_http), null, page, pageSize);

    [McpServerTool(Name = "flight_create_incident")]
    public async Task<object> CreateIncident(string type, string severity, string description, string? resolution = null, string? reportedBy = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var inc = await _flight.CreateIncident(type, severity, description, DateTime.UtcNow, resolution, reportedBy, 0, null);
        Audit("create", "incident", inc.Id, new { via = "mcp", type, severity });
        return inc;
    }

    [McpServerTool(Name = "flight_update_incident")]
    public async Task<object> UpdateIncident(int id, string? type = null, string? severity = null, string? description = null, string? resolution = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var ok = await _flight.UpdateIncident(id, type, severity, description, null, resolution);
        Audit("update", "incident", id, new { via = "mcp", success = ok });
        return ok;
    }

    [McpServerTool(Name = "flight_delete_incident")]
    public async Task<object> DeleteIncident(int id)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var ok = await _flight.DeleteIncident(id);
        Audit("delete", "incident", id, new { via = "mcp", success = ok });
        return ok;
    }
}
