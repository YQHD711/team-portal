using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 采购/报销工具。HTTP 侧 /api/finance 组仅要求登录,但每个动作在体内判 IsStaff
/// (查看全部、审批、驳回、台账、统计),归属校验则允许申请人看自己的单据 —— 这里对齐。
/// </summary>
[McpServerToolType]
public class FinanceTools
{
    private readonly FinanceService _finance;
    private readonly IHttpContextAccessor _http;
    public FinanceTools(FinanceService finance, IHttpContextAccessor http) { _finance = finance; _http = http; }

    private int GetUserId() => McpAuth.UserId(_http);

    [McpServerTool(Name = "finance_list_requests")]
    public async Task<object> ListRequests(string? status = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.GetRequests(status, null);

    [McpServerTool(Name = "finance_get_request")]
    public async Task<object?> GetRequest(int id)
    {
        var req = await _finance.GetRequest(id);
        if (req is TeamPortal.Data.Models.PurchaseRequest r && !McpAuth.IsStaff(_http) && r.RequesterUserId != GetUserId())
            return McpAuth.Forbidden;
        return req;
    }

    [McpServerTool(Name = "finance_create_request")]
    public async Task<object> CreateRequest(string itemName, int quantity, decimal estimatedPrice, string reason)
        => await _finance.CreateRequest(GetUserId(), itemName, quantity, estimatedPrice, reason);

    [McpServerTool(Name = "finance_approve")]
    public async Task<object> Approve(int id) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.Approve(id, GetUserId());
    [McpServerTool(Name = "finance_reject")]
    public async Task<object> Reject(int id, string reason) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.Reject(id, GetUserId(), reason);
    [McpServerTool(Name = "finance_mark_purchased")]
    public async Task<object> MarkPurchased(int id, decimal actualPrice) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.MarkPurchased(id, actualPrice);
    [McpServerTool(Name = "finance_mark_received")]
    public async Task<object> MarkReceived(int id) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.MarkReceived(id);
    [McpServerTool(Name = "finance_monthly_report")]
    public async Task<object> MonthlyReport(int year, int month) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.GetMonthlyReport(year, month);
    [McpServerTool(Name = "finance_stats")]
    public async Task<object> GetStats() => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _finance.GetStats();
}
