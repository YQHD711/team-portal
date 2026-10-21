using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 零件库存工具。HTTP 侧 /api/inventory 组仅要求登录,但创建/导入/修改/删除/上传照片
/// 在体内判 IsStaff —— 这里对齐,避免成员通过 MCP 直接改库存。
/// 写操作补 OperationLog 审计,与 HTTP 端点(InventoryEndpoints 每条写都 Audit)一致。
/// </summary>
[McpServerToolType]
public class InventoryTools
{
    private readonly InventoryService _inv;
    private readonly IHttpContextAccessor _http;
    private readonly LogService? _log;
    public InventoryTools(InventoryService inv, IHttpContextAccessor http, LogService? log = null)
    { _inv = inv; _http = http; _log = log; }

    private void Audit(string action, int id, object data)
        => _log?.Audit(action, McpAuth.UserName(_http), targetType: "item", targetId: id.ToString(),
            data: data, ipAddress: McpAuth.ClientIp(_http), userId: McpAuth.UserId(_http));

    [McpServerTool(Name = "inventory_list")]
    public async Task<object> List(string? search = null, string? category = null) => await _inv.GetAll(search, category);

    [McpServerTool(Name = "inventory_get")]
    public async Task<object?> Get(int id) => await _inv.GetById(id);

    [McpServerTool(Name = "inventory_create")]
    public async Task<object> Create(string name, string category, int quantity, string grade = "C", decimal unitPrice = 0, string? code = null, string? locationCode = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var item = await _inv.Create(name, category, quantity, grade, unitPrice, code, locationCode);
        Audit("create", item.Id, new { via = "mcp", name, category, quantity, grade });
        return item;
    }

    [McpServerTool(Name = "inventory_update")]
    public async Task<object?> Update(int id, string? name = null, int? quantity = null, string? status = null, string? grade = null, decimal? unitPrice = null, string? code = null, string? locationCode = null)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        var item = await _inv.Update(id, name, quantity, status, grade, unitPrice, code, locationCode);
        Audit("update", id, new { via = "mcp", success = item is not null, name, quantity, status, grade });
        return item;
    }

    [McpServerTool(Name = "inventory_get_by_code")]
    public async Task<object?> GetByCode(string code) => await _inv.GetByCode(code);

    [McpServerTool(Name = "inventory_set_photo")]
    public async Task<object> SetPhoto(int id, string photoUrl)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        await _inv.SetPhoto(id, photoUrl);
        Audit("update", id, new { via = "mcp", action = "setPhoto" });
        return "ok";
    }

    [McpServerTool(Name = "inventory_delete")]
    public async Task<object> Delete(int id)
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        var ok = await _inv.Delete(id);
        Audit("delete", id, new { via = "mcp", success = ok });
        return ok;
    }
}
