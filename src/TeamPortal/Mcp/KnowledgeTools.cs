using System.Security.Claims;
using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class KnowledgeTools
{
    private readonly KnowledgeService _knowledge;
    private readonly KnowledgeSearchService _search;
    private readonly IHttpContextAccessor _http;
    public KnowledgeTools(KnowledgeService knowledge, KnowledgeSearchService search, IHttpContextAccessor http) { _knowledge = knowledge; _search = search; _http = http; }

    private (string? role, string? dept, int uid) GetUser()
    {
        var u = _http.HttpContext?.User;
        return (u?.FindFirst(ClaimTypes.Role)?.Value, u?.FindFirst("Department")?.Value, int.TryParse(u?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : 0);
    }

    [McpServerTool(Name = "knowledge_tree")]
    public object GetTree() { var (r, d, u) = GetUser(); return _knowledge.GetTree(r, d, u); }
    [McpServerTool(Name = "knowledge_read")]
    public string? Read(string path) => _knowledge.GetContent(path);
    [McpServerTool(Name = "knowledge_write")]
    public void Write(string path, string content) => _knowledge.WriteFile(path, content);
    [McpServerTool(Name = "knowledge_delete")]
    public void Delete(string path) => _knowledge.DeleteFile(path);
    [McpServerTool(Name = "knowledge_search")]
    public object Search(string query, int topK = 5) => _search.Search(query, topK);
}
