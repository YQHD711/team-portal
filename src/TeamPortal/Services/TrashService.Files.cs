using System.Text.Json;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>回收站里的「保管文件」：把原路径整体搬到 data/trash-files 下暂存。</summary>
public class StashedPath
{
    public string Stored { get; set; } = "";
    public string Original { get; set; } = "";
    public bool IsDir { get; set; }
}

/// <summary>一次删除事件对应的回收站载荷：若干个被保管的路径 + 可选的业务行 JSON。</summary>
public class StashedContent
{
    public List<StashedPath> Paths { get; set; } = new();
    /// <summary>要一并还原的数据库行（如 WikiTask / SharedFile），没有则为 null。</summary>
    public string? RowJson { get; set; }
}

/// <summary>
/// 回收站的「文件/目录」部分。
///
/// 知识库文档、wiki 项目目录这类删除**不能**只往回收站写一行 JSON —— 文档可能几十 MB，
/// 塞进数据库列不合适。做法是把文件/目录整体搬到 data/trash-files/ 保管，
/// 回收站记录里存「保管名 → 原路径」的映射，恢复时再搬回去（目标已存在则拒绝，不覆盖）。
/// </summary>
public partial class TrashService
{
    /// <summary>
    /// 保管目录：与数据库同级（容器里 cwd=/app → /data/trash-files，与知识库同一挂载卷）。
    /// internal set 供单测指向临时目录（测试串行执行，改它安全）。
    /// </summary>
    internal static string StashRoot { get; set; } = Path.GetFullPath(
        Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "trash-files"));

    /// <summary>
    /// 把若干文件/目录移进回收站保管，返回回收站记录（未入库，调用方与业务删除一起 SaveChanges）。
    /// 路径不存在就跳过（记录里留空），保证「文件早就没了」也不会让删除操作失败。
    /// </summary>
    public TrashItem StashPaths(IEnumerable<string> absolutePaths, string title, string table,
        int userId, string userName, object? row = null, int originalId = 0)
    {
        var content = new StashedContent { RowJson = row is null ? null : JsonSerializer.Serialize(row) };

        foreach (var path in absolutePaths.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            var isDir = Directory.Exists(path);
            if (!isDir && !File.Exists(path)) continue;

            Directory.CreateDirectory(StashRoot);
            var stored = $"{Guid.NewGuid():N}_{Path.GetFileName(path.TrimEnd('/', '\\'))}";
            var target = Path.Combine(StashRoot, stored);
            try
            {
                if (isDir) Directory.Move(path, target);
                else File.Move(path, target);
                content.Paths.Add(new StashedPath { Stored = stored, Original = path, IsDir = isDir });
            }
            catch (Exception ex)
            {
                // 搬不动就**不要**记录这条路径：宁可留下原文件，也不能出现"记录说保管了、其实没搬走"
                _log.Error("trash", $"保管失败，跳过：{path}", ex.Message);
            }
        }

        _log.Info("trash", $"Stashed {content.Paths.Count} path(s) for {title}");
        return NewItem(table, originalId, title, content, userId, userName);
    }

    /// <summary>尝试把回收站记录里的保管路径搬回原位；返回 false 表示恢复失败（记录要保留）。</summary>
    private bool RestoreStashedPaths(StashedContent content)
    {
        foreach (var p in content.Paths)
        {
            var from = Path.Combine(StashRoot, p.Stored);
            if (!Directory.Exists(from) && !File.Exists(from))
            {
                _log.Error("trash", $"恢复失败：保管文件不见了 {p.Stored}", p.Original);
                return false;
            }
            if (Directory.Exists(p.Original) || File.Exists(p.Original))
            {
                // 不覆盖：原位置已经有东西了（多半是删除后又新建了同名文档）
                _log.Warn("trash", $"恢复失败：原路径已存在 {p.Original}");
                return false;
            }
            var parent = Path.GetDirectoryName(p.Original);
            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
            if (p.IsDir) Directory.Move(from, p.Original);
            else File.Move(from, p.Original);
        }
        return true;
    }

    /// <summary>读回收站记录里的保管载荷（不是文件类记录时返回 null）。</summary>
    internal static StashedContent? ParseStashed(string dataJson)
    {
        try
        {
            var content = JsonSerializer.Deserialize<StashedContent>(dataJson);
            return content?.Paths.Count > 0 || content?.RowJson is not null ? content : null;
        }
        catch { return null; }
    }
}
