using System.Security.Claims;
using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class FinanceTools
{
    private readonly FinanceService _finance;
    private readonly IHttpContextAccessor _http;
    public FinanceTools(FinanceService finance, IHttpContextAccessor http) { _finance = finance; _http = http; }
    private int GetUserId() => int.TryParse(_http.HttpContext?.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : 0;

    [McpServerTool(Name = "finance_list_requests")]
    public async Task<object> ListRequests(string? status = null) => await _finance.GetRequests(status, null);
    [McpServerTool(Name = "finance_get_request")]
    public async Task<object?> GetRequest(int id) => await _finance.GetRequest(id);
    [McpServerTool(Name = "finance_create_request")]
    public async Task<object> CreateRequest(string itemName, int quantity, decimal estimatedPrice, string reason) => await _finance.CreateRequest(GetUserId(), itemName, quantity, estimatedPrice, reason);
    [McpServerTool(Name = "finance_approve")]
    public async Task<bool> Approve(int id) => await _finance.Approve(id, GetUserId());
    [McpServerTool(Name = "finance_reject")]
    public async Task<bool> Reject(int id, string reason) => await _finance.Reject(id, GetUserId(), reason);
    [McpServerTool(Name = "finance_mark_purchased")]
    public async Task<bool> MarkPurchased(int id, decimal actualPrice) => await _finance.MarkPurchased(id, actualPrice);
    [McpServerTool(Name = "finance_mark_received")]
    public async Task<bool> MarkReceived(int id) => await _finance.MarkReceived(id);
    [McpServerTool(Name = "finance_monthly_report")]
    public async Task<object> MonthlyReport(int year, int month) => await _finance.GetMonthlyReport(year, month);
    [McpServerTool(Name = "finance_stats")]
    public async Task<object> GetStats() => await _finance.GetStats();
}
