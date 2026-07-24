using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class InventoryTools
{
    private readonly InventoryService _inv;
    public InventoryTools(InventoryService inv) => _inv = inv;

    [McpServerTool(Name = "inventory_list")]
    public async Task<object> List(string? search = null, string? category = null) => await _inv.GetAll(search, category);
    [McpServerTool(Name = "inventory_get")]
    public async Task<object?> Get(int id) => await _inv.GetById(id);
    [McpServerTool(Name = "inventory_create")]
    public async Task<object> Create(string name, string category, int quantity, string grade = "C", decimal unitPrice = 0, int? departmentId = null, string? projectTag = null, string? locationCode = null) => await _inv.Create(name, category, quantity, grade, unitPrice, departmentId, projectTag, locationCode);
    [McpServerTool(Name = "inventory_update")]
    public async Task<object?> Update(int id, string? grade = null, decimal? unitPrice = null, int? departmentId = null, string? projectTag = null, string? locationCode = null) => await _inv.Update(id, grade, unitPrice, departmentId, projectTag, locationCode);
    [McpServerTool(Name = "inventory_set_photo")]
    public async Task SetPhoto(int id, string photoUrl) => await _inv.SetPhoto(id, photoUrl);
    [McpServerTool(Name = "inventory_delete")]
    public async Task<bool> Delete(int id) => await _inv.Delete(id);
}
