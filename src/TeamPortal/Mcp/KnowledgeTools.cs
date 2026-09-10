using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 知识库工具。HTTP 侧读操作走 CanAccess(按角色/部门过滤),写操作在 /api/knowledge
/// 的 StaffOnly 组内且同样过 CanAccess —— 这里必须逐项对齐,否则任意成员可跨部门读写删。
/// </summary>
[McpServerToolType]
public class KnowledgeTools
{
    private readonly KnowledgeService _knowledge;
    private readonly KnowledgeSearchService _search;
    private readonly IHttpContextAccessor _http;
    public KnowledgeTools(KnowledgeService knowledge, KnowledgeSearchService search, IHttpContextAccessor http)
    { _knowledge = knowledge; _search = search; _http = http; }

    private (string? role, string? dept, int uid) GetUser() => (McpAuth.Role(_http), McpAuth.Department(_http), McpAuth.UserId(_http));

    [McpServerTool(Name = "knowledge_tree")]
    public object GetTree() { var (r, d, u) = GetUser(); return _knowledge.GetTree(r, d, u); }

    [McpServerTool(Name = "knowledge_read")]
    public string? Read(string path)
    {
        var (r, d, _) = GetUser();
        if (!_knowledge.CanAccess(path, r, d)) return McpAuth.Forbidden;
        return _knowledge.GetContent(path);
    }

    [McpServerTool(Name = "knowledge_write")]
    public string Write(string path, string content)
    {
        var (r, d, _) = GetUser();
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        if (!_knowledge.CanAccess(path, r, d)) return McpAuth.Forbidden;
        _knowledge.WriteFile(path, content);
        return "ok";
    }

    [McpServerTool(Name = "knowledge_delete")]
    public string Delete(string path)
    {
        var (r, d, _) = GetUser();
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        if (!_knowledge.CanAccess(path, r, d)) return McpAuth.Forbidden;
        _knowledge.DeleteFile(path);
        return "ok";
    }

    [McpServerTool(Name = "knowledge_search")]
    public object Search(string query, int topK = 5)
    {
        // 检索索引覆盖全部部门,必须把调用者身份传下去做范围过滤
        var (r, d, u) = GetUser();
        return _search.Search(query, topK, r, d, u);
    }
}
