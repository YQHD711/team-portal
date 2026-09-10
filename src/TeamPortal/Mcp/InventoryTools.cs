using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 零件库存工具。HTTP 侧 /api/inventory 组仅要求登录,但创建/导入/修改/删除/上传照片
/// 在体内判 IsStaff —— 这里对齐,避免成员通过 MCP 直接改库存。
/// </summary>
[McpServerToolType]
public class InventoryTools
{
    private readonly InventoryService _inv;
    private readonly IHttpContextAccessor _http;
    public InventoryTools(InventoryService inv, IHttpContextAccessor http) { _inv = inv; _http = http; }

    [McpServerTool(Name = "inventory_list")]
    public async Task<object> List(string? search = null, string? category = null) => await _inv.GetAll(search, category);
    [McpServerTool(Name = "inventory_get")]
    public async Task<object?> Get(int id) => await _inv.GetById(id);
    [McpServerTool(Name = "inventory_create")]
    public async Task<object> Create(string name, string category, int quantity, string grade = "C", decimal unitPrice = 0, int? departmentId = null, string? projectTag = null, string? locationCode = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _inv.Create(name, category, quantity, grade, unitPrice, departmentId, projectTag, locationCode);
    [McpServerTool(Name = "inventory_update")]
    public async Task<object?> Update(int id, string? name = null, int? quantity = null, string? status = null, string? grade = null, decimal? unitPrice = null, int? departmentId = null, string? projectTag = null, string? locationCode = null)
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _inv.Update(id, name, quantity, status, grade, unitPrice, departmentId, projectTag, locationCode);
    [McpServerTool(Name = "inventory_set_photo")]
    public async Task<object> SetPhoto(int id, string photoUrl)
    {
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        await _inv.SetPhoto(id, photoUrl);
        return "ok";
    }
    [McpServerTool(Name = "inventory_delete")]
    public async Task<object> Delete(int id) => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _inv.Delete(id);
}
