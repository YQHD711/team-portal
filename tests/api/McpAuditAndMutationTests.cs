using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TeamPortal.Data.Models;
using TeamPortal.Mcp;
using TeamPortal.Services;

namespace api;

/// <summary>
/// F-04：MCP 写操作必须与 HTTP 一样落 OperationLog，且
/// profile_update 不能自写组织评定字段、knowledge_delete 必须走回收站、备份恢复需要 confirm。
/// </summary>
public class McpAuditAndMutationTests : McpTestBase
{
    [Fact]
    public async Task ProfileUpdate_IgnoresLevelAndFlightHours_ButUpdatesSelfFields()
    {
        Db.PilotProfiles.Add(new PilotProfile { UserId = 1, Level = "A", TotalFlightHours = 12, Bio = "旧简介" });
        await Db.SaveChangesAsync();

        var tools = new ProfileTools(new ProfileService(Db, Log), Accessor("member", 1), Log);
        Assert.True(await tools.Update(level: "C", flightHours: 999, bio: "新简介"));

        await using var check = NewContext();
        var profile = await check.PilotProfiles.SingleAsync();
        Assert.Equal("A", profile.Level);            // 组织评定字段未被本人改写
        Assert.Equal(12, profile.TotalFlightHours);
        Assert.Equal("新简介", profile.Bio);         // 自填字段仍生效
        Assert.NotNull(await WaitForAuditAsync(o => o.Action == "profile" && o.UserId == 1));
    }

    [Fact]
    public async Task KnowledgeDelete_MovesToTrashAndWritesAudit()
    {
        var root = Path.Combine(Work, "knowledge");
        var file = Path.Combine(root, "公共", "资料", "说明.md");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        await File.WriteAllTextAsync(file, "原始内容");
        TrashService.StashRoot = Path.Combine(Work, "_stash");

        var config = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Knowledge:BasePath"] = root }).Build();
        var knowledge = new KnowledgeService(config, Log, Scopes);
        var tools = new KnowledgeTools(knowledge, null!, Db, new TrashService(Db, Log, null!), Log, Accessor("admin", 2));

        Assert.Equal("ok", await tools.Delete("公共/资料/说明.md"));

        Assert.False(File.Exists(file));
        var item = await Db.TrashItems.AsNoTracking().SingleAsync();
        Assert.Equal("KnowledgePath", item.OriginalTable);   // 走了回收站，未直接删除
        Assert.Equal(2, item.DeletedByUserId);
        Assert.NotNull(await WaitForAuditAsync(o => o.Action == "delete" && o.TargetType == "knowledge"));
    }

    [Fact]
    public async Task KnowledgeDelete_MemberIsForbiddenBeforeTouchingServices()
    {
        var tools = new KnowledgeTools(null!, null!, null!, null!, null!, Accessor("member", 1));
        Assert.Equal(McpAuth.Forbidden, await tools.Delete("公共/资料/说明.md"));
    }

    [Fact]
    public async Task BackupRestore_WithoutConfirm_IsRefusedBeforeTouchingBackup()
    {
        var tools = new SystemTools(null!, Log, null!, Accessor("admin", 2));
        var text = Assert.IsType<string>(await tools.BackupRestore("snapshot.db", confirm: false));
        Assert.NotEqual(McpAuth.Forbidden, text);
        Assert.Contains("confirm", text);   // 管理员也必须显式确认，且比触碰 BackupService 更早返回
    }
}
