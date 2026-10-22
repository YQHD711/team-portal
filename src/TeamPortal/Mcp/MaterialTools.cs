using ModelContextProtocol.Server;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 器材领用工具。自助动作(领用/归还/报损)按当前用户身份执行,与 HTTP 侧一致;
/// 审批/驳回/发起盘点在 HTTP 侧有显式角色校验(MaterialEndpoints: 部长审批、
/// 管理员终审、staff 驳回与盘点),这里必须对齐 —— 服务层本身不校验审批人角色。
/// 审批/驳回还要求"部长必须是申请人所在部门的部长",与 HTTP 的部门比对一致;
/// 关键写操作补 OperationLog 审计(HTTP 侧同样每条都写)。
/// </summary>
[McpServerToolType]
public class MaterialTools
{
    private readonly MaterialService _material;
    private readonly IHttpContextAccessor _http;
    private readonly LogService? _log;
    public MaterialTools(MaterialService material, IHttpContextAccessor http, LogService? log = null)
    { _material = material; _http = http; _log = log; }

    private int GetUserId() => McpAuth.UserId(_http);

    private void Audit(string action, int requestId, object data, int userId)
        => _log?.Audit(action, McpAuth.UserName(_http), targetType: "material", targetId: requestId.ToString(),
            data: data, ipAddress: McpAuth.ClientIp(_http), userId: userId);

    [McpServerTool(Name = "material_create_checkout")]
    public async Task<object> CreateCheckout(int itemId, int quantity, string note)
    {
        var uid = GetUserId();
        var req = await _material.CreateCheckout(itemId, uid, quantity, note);
        Audit("checkout", req.Id, new { via = "mcp", itemId, quantity, status = req.Status }, uid);
        return req;
    }

    [McpServerTool(Name = "material_approve_dept")]
    public async Task<object?> ApproveDept(int requestId)
    {
        // HTTP approve-dept:仅部长,且必须是申请人所在部门的部长(MaterialEndpoints.cs:100-103)
        if (McpAuth.Role(_http) != "部长") return McpAuth.Forbidden;
        var uid = GetUserId();
        if (!await _material.IsApproverSameDepartmentAsRequester(requestId, uid)) return McpAuth.Forbidden;
        var req = await _material.ApproveDept(requestId, uid);
        Audit("dept-approve", requestId, new { via = "mcp", success = req is not null, status = req?.Status }, uid);
        return req;
    }

    [McpServerTool(Name = "material_approve_admin")]
    public async Task<object?> ApproveAdmin(int requestId)
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        var uid = GetUserId();
        var req = await _material.ApproveAdmin(requestId, uid);
        Audit("admin-approve", requestId, new { via = "mcp", success = req is not null, status = req?.Status }, uid);
        return req;
    }

    [McpServerTool(Name = "material_reject_request")]
    public async Task<object?> RejectRequest(int requestId, string reason)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var uid = GetUserId();
        // HTTP reject:管理员可跨部门驳回;部长只可驳回本部门队员的申请(MaterialEndpoints.cs:145-150)
        if (McpAuth.Role(_http) == "部长" && !await _material.IsApproverSameDepartmentAsRequester(requestId, uid))
            return McpAuth.Forbidden;
        var req = await _material.RejectRequest(requestId, uid, reason);
        Audit("reject", requestId, new { via = "mcp", reason, success = req is not null }, uid);
        return req;
    }

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
    {
        // 与 HTTP 对齐：POST /api/material/checkout/{id}/checkin 要求 IsStaff（`MaterialEndpoints.cs:183`）。
        // 之前 MCP 没判 → 任意成员可代他人归还并触发库存回加（审计 #9）。
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var uid = GetUserId();
        var record = await _material.Checkin(requestId, uid, condition, hasPhoto, testNotes, photoUrl);
        Audit("checkin", requestId, new { via = "mcp", condition, hasPhoto, success = record is not null }, uid);
        return record;
    }

    [McpServerTool(Name = "material_start_stocktake")]
    public async Task<object> StartStocktake(string type, string grade)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var uid = GetUserId();
        var st = await _material.StartStocktake(type, grade, uid);
        Audit("stocktake", st.Id, new { via = "mcp", action = "start", type, grade, itemCount = st.Items.Count }, uid);
        return st;
    }

    [McpServerTool(Name = "material_list_stocktakes")]
    public async Task<object> ListStocktakes()
        // 与 HTTP 对齐：GET /api/material/stocktake 同样仅 staff（`MaterialEndpoints.cs:220`）
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _material.GetStocktakes();

    [McpServerTool(Name = "material_report_damage")]
    public async Task<object> ReportDamage(int itemId, string type, string description, bool isApprovedTest = false)
    {
        var uid = GetUserId();
        var report = await _material.CreateDamageReport(itemId, uid, type, description, isApprovedTest);
        Audit("damage-report", report.Id, new { via = "mcp", itemId, type, isApprovedTest }, uid);
        return report;
    }
}
