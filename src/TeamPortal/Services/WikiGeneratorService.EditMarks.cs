using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// 「已人工修改」标记的读写 + 写接口的目录范围校验。
///
/// 标记存 DB 表 <c>WikiDocEdits</c>（任务 × 语言 × 文档路径，唯一索引）：
/// 重新生成（<c>POST /api/wiki/tasks/{id}/update</c>）前先查它，有标记就要求确认，
/// 避免 AI 复审把人工修改冲掉（方案 c）。未标记的文档行为完全不变。
/// </summary>
public partial class WikiGeneratorService
{
    public record WikiEditMarkInfo(string Path, string Lang, DateTime MarkedAt, string? Editor);

    /// <summary>写回人工修改后打标（同一文档重复写入只刷新标记，不会堆积多行）。</summary>
    public async Task MarkDocumentEdited(string taskId, string path, string lang, int? userId, string? editor)
    {
        var mark = await _db.WikiDocEdits
            .FirstOrDefaultAsync(m => m.TaskId == taskId && m.Lang == lang && m.Path == path);
        if (mark is null)
        {
            _db.WikiDocEdits.Add(new WikiDocEdit
            {
                TaskId = taskId, Path = path, Lang = lang, UserId = userId, Editor = editor,
            });
        }
        else
        {
            mark.MarkedAt = DateTime.UtcNow;
            mark.UserId = userId;
            mark.Editor = editor;
        }
        await _db.SaveChangesAsync();
    }

    /// <summary>该任务下所有人工修改标记（含语言：zh/en 是两份不同的文档）。</summary>
    public async Task<List<WikiEditMarkInfo>> GetEditMarks(string taskId) =>
        await _db.WikiDocEdits.Where(m => m.TaskId == taskId)
            .OrderBy(m => m.Path).ThenBy(m => m.Lang)
            .Select(m => new WikiEditMarkInfo(m.Path, m.Lang, m.MarkedAt, m.Editor))
            .ToListAsync();

    /// <summary>清除该任务的全部标记（用户确认覆盖后调用），返回清掉的条数。</summary>
    public async Task<int> ClearEditMarks(string taskId)
    {
        var marks = await _db.WikiDocEdits.Where(m => m.TaskId == taskId).ToListAsync();
        if (marks.Count == 0) return 0;
        _db.WikiDocEdits.RemoveRange(marks);
        await _db.SaveChangesAsync();
        return marks.Count;
    }

    /// <summary>
    /// 该 path 是否属于这个任务的目录（CatalogJson 里的叶节点）。
    /// 写接口据此限定范围：部长对「本部门/」整个前缀有写权限，但也不能借 path
    /// 改到同部门另一个项目的文档；不在目录里的路径一律当"文档不存在"。
    /// </summary>
    public bool IsCatalogDocument(WikiTask task, string path)
    {
        if (!IsSafeCatalogPath(path)) return false;
        List<CatalogItem> items;
        try { items = JsonSerializer.Deserialize<List<CatalogItem>>(task.CatalogJson ?? "[]", JsonOpts) ?? []; }
        catch { return false; }
        return FlattenCatalog(items).Any(i => (i.Children is null or { Count: 0 }) && i.Path == path);
    }
}
