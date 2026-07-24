using System.Security.Claims;
using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class MaterialTools
{
    private readonly MaterialService _material;
    private readonly IHttpContextAccessor _http;
    public MaterialTools(MaterialService material, IHttpContextAccessor http) { _material = material; _http = http; }
    private int GetUserId() => int.TryParse(_http.HttpContext?.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : 0;

    [McpServerTool(Name = "material_create_checkout")]
    public async Task<object> CreateCheckout(int itemId, int quantity, string note) => await _material.CreateCheckout(itemId, GetUserId(), quantity, note);
    [McpServerTool(Name = "material_approve_dept")]
    public async Task<object?> ApproveDept(int requestId) => await _material.ApproveDept(requestId, GetUserId());
    [McpServerTool(Name = "material_approve_admin")]
    public async Task<object?> ApproveAdmin(int requestId) => await _material.ApproveAdmin(requestId, GetUserId());
    [McpServerTool(Name = "material_reject_request")]
    public async Task<object?> RejectRequest(int requestId, string reason) => await _material.RejectRequest(requestId, GetUserId(), reason);
    [McpServerTool(Name = "material_get_request")]
    public async Task<object?> GetRequest(int id) => await _material.GetRequest(id);
    [McpServerTool(Name = "material_my_requests")]
    public async Task<object> MyRequests() => await _material.GetMyRequests(GetUserId());
    [McpServerTool(Name = "material_checkin")]
    public async Task<object?> Checkin(int requestId, string condition, bool hasPhoto, string? testNotes = null, string? photoUrl = null) => await _material.Checkin(requestId, GetUserId(), condition, hasPhoto, testNotes, photoUrl);
    [McpServerTool(Name = "material_start_stocktake")]
    public async Task<object> StartStocktake(string type, string grade) => await _material.StartStocktake(type, grade, GetUserId());
    [McpServerTool(Name = "material_list_stocktakes")]
    public async Task<object> ListStocktakes() => await _material.GetStocktakes();
    [McpServerTool(Name = "material_report_damage")]
    public async Task<object> ReportDamage(int itemId, string type, string description, bool isApprovedTest = false) => await _material.CreateDamageReport(itemId, GetUserId(), type, description, isApprovedTest);
}
