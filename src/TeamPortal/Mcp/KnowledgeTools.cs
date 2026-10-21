using ModelContextProtocol.Server;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 知识库工具。HTTP 侧读操作走 CanAccess(按角色/部门过滤),写操作在 /api/knowledge
/// 的 StaffOnly 组内且同样过 CanAccess —— 这里必须逐项对齐,否则任意成员可跨部门读写删。
/// 删除与 HTTP 一致:先把文件/目录整体搬进回收站(可恢复)再删,并写 OperationLog 审计。
/// </summary>
[McpServerToolType]
public class KnowledgeTools
{
    private readonly KnowledgeService _knowledge;
    private readonly KnowledgeSearchService _search;
    private readonly AppDbContext _db;
    private readonly TrashService _trash;
    private readonly LogService _log;
    private readonly IHttpContextAccessor _http;

    public KnowledgeTools(KnowledgeService knowledge, KnowledgeSearchService search, AppDbContext db,
        TrashService trash, LogService log, IHttpContextAccessor http)
    { _knowledge = knowledge; _search = search; _db = db; _trash = trash; _log = log; _http = http; }

    private (string? role, string? dept, int uid) GetUser() => (McpAuth.Role(_http), McpAuth.Department(_http), McpAuth.UserId(_http));

    private void Audit(string action, string targetId, object data, int userId)
        => _log.Audit(action, McpAuth.UserName(_http), targetType: "knowledge", targetId: targetId,
            data: data, ipAddress: McpAuth.ClientIp(_http), userId: userId);

    [McpServerTool(Name = "knowledge_tree")]
    public object GetTree() { var (r, d, u) = GetUser(); return _knowledge.GetTree(r, d, u); }

    [McpServerTool(Name = "knowledge_read")]
    public string? Read(string path)
    {
        var (r, d, u) = GetUser();
        if (!_knowledge.CanAccess(path, r, d)) return McpAuth.Forbidden;
        // 审计 #13：路径 ACL 挡不住同部门里别人的 personal 项目，补上 wiki 项目可见性
        if (!_search.IsWikiProjectVisibleTo(path, r, d, u)) return McpAuth.Forbidden;
        return _knowledge.GetContent(path);
    }

    [McpServerTool(Name = "knowledge_write")]
    public string Write(string path, string content)
    {
        var (r, d, u) = GetUser();
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        if (!_knowledge.CanAccess(path, r, d)) return McpAuth.Forbidden;
        try
        {
            _knowledge.WriteFile(path, content);
            _log.Info("knowledge", $"File written: {path} by {McpAuth.UserName(_http)}");
            Audit("update", path, new { via = "mcp", success = true }, u);
            return "ok";
        }
        catch (Exception e)
        {
            _log.Error("knowledge", $"Write failed: {path}", e.Message);
            Audit("update", path, new { via = "mcp", success = false, error = e.Message }, u);
            throw;
        }
    }

    [McpServerTool(Name = "knowledge_delete")]
    public async Task<string> Delete(string path)
    {
        var (r, d, u) = GetUser();
        // HTTP /api/admin/knowledge/delete 在 /api/admin 的 StaffOnly 组内 + CanAccess
        if (!McpAuth.IsStaff(_http)) return McpAuth.Forbidden;
        if (!_knowledge.CanAccess(path, r, d)) return McpAuth.Forbidden;

        var actor = McpAuth.UserName(_http);
        try
        {
            var abs = _knowledge.AbsolutePath(path);
            if (abs is null) return McpAuth.Forbidden;
            if (!File.Exists(abs) && !Directory.Exists(abs))
            {
                // 与 HTTP 一致：路径不存在按失败处理（HTTP 侧 DeleteFile 抛 "File not found" → 400）
                _log.Error("knowledge", $"Delete failed: {path}", "File not found");
                Audit("delete", path, new { via = "mcp", success = false, error = "File not found" }, u);
                return "Error: File not found";
            }
            // 与 HTTP 一致：先整体搬进回收站（可恢复），再走删除收尾
            _db.TrashItems.Add(_trash.StashPaths(new[] { abs }, $"知识库：{path}", "KnowledgePath", u, actor));
            await _db.SaveChangesAsync();
            // StashPaths 已经把目标搬走；仅在还有残留时才调用 DeleteFile，避免"文件不存在"误报失败
            if (File.Exists(abs) || Directory.Exists(abs)) _knowledge.DeleteFile(path);
            _log.Warn("knowledge", $"File deleted (moved to trash): {path} by {actor}");
            Audit("delete", path, new { via = "mcp", success = true, trash = true }, u);
            return "ok";
        }
        catch (Exception e)
        {
            _log.Error("knowledge", $"Delete failed: {path}", e.Message);
            Audit("delete", path, new { via = "mcp", success = false, error = e.Message }, u);
            return $"Error: {e.Message}";
        }
    }

    [McpServerTool(Name = "knowledge_search")]
    public object Search(string query, int topK = 5)
    {
        // 检索索引覆盖全部部门,必须把调用者身份传下去做范围过滤
        var (r, d, u) = GetUser();
        return _search.Search(query, topK, r, d, u);
    }
}
