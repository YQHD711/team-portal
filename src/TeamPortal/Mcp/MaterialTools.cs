using ModelContextProtocol.Server;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 器材领用工具。自助动作(领用/归还/报损)按当前用户身份执行,与 HTTP 侧一致;
/// 审批/驳回/发起盘点在 HTTP 侧有显式角色校验(MaterialEndpoints: 部长审批、
/// 管理员终审、staff 驳回与盘点),这里必须对齐 —— 服务层本身不校验审批人角色。
/// </summary>
[McpServerToolType]
public class MaterialTools
{
    private readonly MaterialService _material;
    private readonly IHttpContextAccessor _http;
    public MaterialTools(MaterialService material, IHttpContextAccessor http) { _material = material; _http = http; }

    private int GetUserId() => McpAuth.UserId(_http);

    [McpServerTool(Name = "material_create_checkout")]
    public async Task<object> CreateCheckout(int itemId, int quantity, string note) => await _material.CreateCheckout(itemId, GetUserId(), quantity, note);

    [McpServerTool(Name = "material_approve_dept")]
    public async Task<object?> ApproveDept(int requestId)
        => McpAuth.Role(_http) != "部长" ? McpAuth.Forbidden : await _material.ApproveDept(requestId, GetUserId());

    [McpServerTool(Name = "material_approve_admin")]
    public async Task<object?> ApproveAdmin(int requestId)
        => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _material.ApproveAdmin(requestId, GetUserId());

    [McpServerTool(Name = "material_reject_request")]
    public async Task<object?> RejectRequest(int requestId, string reason)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _material.RejectRequest(requestId, GetUserId(), reason);

    [McpServerTool(Name = "material_get_request")]
    public async Task<object?> GetRequest(int id)
    {
        var req = await _material.GetRequest(id);
        // 与 MaterialEndpoints 一致:非 staff 只能看自己的申请,其余一律 Forbidden 防枚举
        if (req is CheckoutRequest r && !McpAuth.IsStaff(_http) && r.RequesterUserId != GetUserId())
            return McpAuth.Forbidden;
        return req;
    }

    [McpServerTool(Name = "material_my_requests")]
    public async Task<object> MyRequests() => await _material.GetMyRequests(GetUserId());
    [McpServerTool(Name = "material_checkin")]
    public async Task<object?> Checkin(int requestId, string condition, bool hasPhoto, string? testNotes = null, string? photoUrl = null)
        => await _material.Checkin(requestId, GetUserId(), condition, hasPhoto, testNotes, photoUrl);

    [McpServerTool(Name = "material_start_stocktake")]
    public async Task<object> StartStocktake(string type, string grade)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _material.StartStocktake(type, grade, GetUserId());

    [McpServerTool(Name = "material_list_stocktakes")]
    public async Task<object> ListStocktakes() => await _material.GetStocktakes();

    [McpServerTool(Name = "material_report_damage")]
    public async Task<object> ReportDamage(int itemId, string type, string description, bool isApprovedTest = false)
        => await _material.CreateDamageReport(itemId, GetUserId(), type, description, isApprovedTest);
}
