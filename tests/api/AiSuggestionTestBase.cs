using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-14 A 的公共夹具：一份临时知识库（含两个部门的学习库与几篇真实文档）+ 一个内存库
/// （2 个房间、3 件物料）。派生类各自钉不同的性质（出题真实性 / ACL / 缓存 / 库存守门）。
/// </summary>
public abstract class AiSuggestionTestBase : IDisposable
{
    protected readonly string KbDir;
    protected readonly AppDbContext Db;
    protected readonly KnowledgeService Knowledge;

    protected AiSuggestionTestBase()
    {
        KbDir = Path.Combine(Path.GetTempPath(), $"tp-suggest-{Guid.NewGuid():N}");
        SeedKb(KbDir);
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        Db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        Db.Database.EnsureCreated();
        Db.StorageLayouts.AddRange(
            new StorageLayout { RoomCode = "1011", RoomName = "展厅", Floor = 1, CabinetCount = 4, ShelfCount = 4, PositionCount = 8 },
            new StorageLayout { RoomCode = "1030", RoomName = "库房", Floor = 1, CabinetCount = 4, ShelfCount = 4, PositionCount = 8,
                Description = "航模器材库房",
                LayoutJson = """{"items":[{"name":"A货架","locCode":"1030-A","shelfCount":4,"positionCount":8}]}""" });
        Db.InventoryItems.AddRange(
            Real("碳纤维管", "EL-CFRP-2026-0001", 7), Real("无刷电机", "EL-MOTOR-2026-0002", 3), Real("锂电池", "EL-LIPO-2026-0003", 12));
        Db.SaveChanges();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Knowledge:BasePath"] = KbDir }).Build();
        var scopes = new TestScopeFactory(Db);
        Knowledge = new KnowledgeService(config, new NullLogService(scopes), scopes);
    }

    public void Dispose()
    {
        try { Directory.Delete(KbDir, true); } catch { /* best-effort */ }
        Db.Dispose();
        GC.SuppressFinalize(this);
    }

    protected static InventoryItem Real(string name, string code, int qty) =>
        new() { Name = name, Code = code, Category = "测试", Quantity = qty, LocationCode = "1030-A-1-01", Grade = "B" };

    protected AiSuggestionService Create() => new(Knowledge, Db, NullLogger<AiSuggestionService>.Instance);

    /// <summary>知识库里真实存在的文档名 → 文件（同名可能多份，因此按名字分组；`_` 开头是元信息文件）。</summary>
    protected Dictionary<string, List<string>> RealDocFiles() =>
        Directory.GetFiles(KbDir, "*.md", SearchOption.AllDirectories)
            .Where(f => !Path.GetFileName(f).StartsWith('_'))
            .GroupBy(f => AiSuggestionService.DisplayTitle(Path.GetFileName(f)), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

    private static void SeedKb(string kb)
    {
        void Write(string rel, string content)
        {
            var full = Path.Combine(kb, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
        }
        Write("公共/参考资料/物料管理规范.md",
            "# 物料管理规范\n\n## 目录\n\n- 领用\n\n## 领用与归还\n\nB 级物料需部长审批。\n\n## 入库验收\n\n数量与编码要核对。\n");
        Write("公共/参考资料/协会章程.md", "# 协会章程\n\n## 组织架构\n\n设部长与队员。\n");
        Write("工程部/工程部安全须知.md", "# 工程部安全须知\n\n## 试飞安全\n\n跑道两侧禁止站人。\n");
        Write("工程部/学习库/_学习路径.md", "# 工程部学习路径\n\n## 阶段总览\n\n01-工程基础。\n");
        Write("工程部/学习库/01-工程基础/01-投影与视图表达.md", "# 课时\n");
        Write("电子部/电子部规范.md", "# 电子部规范\n\n## 焊接流程\n\n先接地再焊接。\n");
        Write("电子部/学习库/_学习路径.md", "# 电子部学习路径\n\n## 阶段总览\n\n01-电子基础。\n");
        Write("电子部/学习库/01-电子基础/01-元器件识别.md", "# 课时\n");
        Write("公共/ArdupilotWiki/plane.md", "# Plane\n\n## RTL Mode\n\nReturn to launch.\n");
    }
}
