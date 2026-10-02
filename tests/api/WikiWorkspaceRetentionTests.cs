using Microsoft.EntityFrameworkCore;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 保留策略：工作区持久化到挂卷目录后磁盘会无限增长，所以只留最近 N 个。
/// 判定细节：终态任务按 CompletedAt ?? CreatedAt 倒序，前 N 个留下，其余目录删除（任务记录保留）；
/// 非终态（正在运行）一律跳过；刚克隆/刚生成的那个任务由 exceptTaskId 兜底保护；失败只记日志。
/// </summary>
public class WikiWorkspaceRetentionTests : WikiWorkspaceTestBase
{
    [Fact]
    public async Task Cleanup_KeepsMostRecentNAndDeletesOlder()
    {
        for (var i = 0; i < 4; i++)
        {
            await SeedTask($"t{i}", completedAt: DateTime.UtcNow.AddMinutes(-i));
            MakeWorkspace($"t{i}");
        }

        var removed = await Create(WsRoot, keep: "2").CleanupWorkspacesAsync();

        Assert.Equal(2, removed);
        Assert.True(Directory.Exists(WsDir("t0")));   // 最新两个留下
        Assert.True(Directory.Exists(WsDir("t1")));
        Assert.False(Directory.Exists(WsDir("t2")));  // 超出的删掉
        Assert.False(Directory.Exists(WsDir("t3")));
        Assert.Equal(4, await Db.WikiTasks.CountAsync()); // 任务记录保留（只是源码浏览会 404）
    }

    [Fact]
    public async Task Cleanup_NeverDeletesRunningTasks()
    {
        await SeedTask("old-done", completedAt: DateTime.UtcNow.AddHours(-3));
        await SeedTask("running", status: "documents", completedAt: DateTime.UtcNow.AddHours(-4));
        await SeedTask("new-done", completedAt: DateTime.UtcNow);
        MakeWorkspace("old-done"); MakeWorkspace("running"); MakeWorkspace("new-done");

        var removed = await Create(WsRoot, keep: "1").CleanupWorkspacesAsync();

        Assert.Equal(1, removed);
        Assert.False(Directory.Exists(WsDir("old-done"))); // 唯一被删的
        Assert.True(Directory.Exists(WsDir("running")));   // 运行中：最旧也不删
        Assert.True(Directory.Exists(WsDir("new-done")));
    }

    [Fact]
    public async Task Cleanup_ProtectsTheJustRestoredTask()
    {
        await SeedTask("newest", completedAt: DateTime.UtcNow);
        await SeedTask("middle", completedAt: DateTime.UtcNow.AddHours(-1));
        await SeedTask("just-cloned", completedAt: DateTime.UtcNow.AddHours(-5)); // 老任务，刚重新克隆回来
        MakeWorkspace("newest"); MakeWorkspace("middle"); MakeWorkspace("just-cloned");

        // keep=1，但刚克隆的那个必须额外保住（否则「重新克隆」会被自己触发的清理立刻删掉）
        var removed = await Create(WsRoot, keep: "1").CleanupWorkspacesAsync("just-cloned");

        Assert.Equal(1, removed);
        Assert.True(Directory.Exists(WsDir("just-cloned")));
        Assert.True(Directory.Exists(WsDir("newest")));
        Assert.False(Directory.Exists(WsDir("middle")));
    }

    [Fact]
    public async Task Cleanup_UsesKeepSettingFromDb_OverConfig()
    {
        await SetSetting("Wiki:WorkspaceKeep", "1");
        for (var i = 0; i < 3; i++)
        {
            await SeedTask($"t{i}", completedAt: DateTime.UtcNow.AddMinutes(-i));
            MakeWorkspace($"t{i}");
        }

        // 配置说留 5 个、设置说留 1 个 → 设置优先（否则设置页改了不生效）
        var removed = await Create(WsRoot, keep: "5").CleanupWorkspacesAsync();

        Assert.Equal(2, removed);
    }

    [Fact]
    public async Task Cleanup_ToleratesTrailingSeparatorInRoot()
    {
        await SetSetting("Wiki:WorkspaceRoot", WsRoot + Path.DirectorySeparatorChar); // 设置页手填带尾斜杠
        await SeedTask("old1", completedAt: DateTime.UtcNow.AddHours(-1));
        await SeedTask("old2", completedAt: DateTime.UtcNow.AddHours(-2));
        MakeWorkspace("old1"); MakeWorkspace("old2");

        var removed = await Create(WsRoot + Path.DirectorySeparatorChar, keep: "1").CleanupWorkspacesAsync();

        Assert.Equal(1, removed);   // 尾斜杠不能让清理静默失效
        Assert.True(Directory.Exists(WsDir("old1")));
        Assert.False(Directory.Exists(WsDir("old2")));
    }

    [Fact]
    public async Task Cleanup_UnderLimitOrMissingRoot_DeletesNothing()
    {
        await SeedTask("only", completedAt: DateTime.UtcNow);
        MakeWorkspace("only");

        Assert.Equal(0, await Create(WsRoot, keep: "20").CleanupWorkspacesAsync());
        Assert.True(Directory.Exists(WsDir("only")));
        Assert.Equal(0, await Create(Path.Combine(Tmp, "no-such-root"), keep: "20").CleanupWorkspacesAsync());
    }

    [Fact]
    public async Task Cleanup_DeleteFailure_DoesNotThrow()
    {
        await SeedTask("locked", completedAt: DateTime.UtcNow.AddHours(-1));
        await SeedTask("newer", completedAt: DateTime.UtcNow);
        MakeWorkspace("locked"); MakeWorkspace("newer");
        using var stream = new FileStream(Path.Combine(WsDir("locked"), "repo", "locked.bin"),
            FileMode.Create, FileAccess.Write, FileShare.None);

        // 清理失败只记日志，不能把异常抛给生成/克隆主流程
        var removed = await Create(WsRoot, keep: "1").CleanupWorkspacesAsync();

        if (OperatingSystem.IsWindows())
        {
            Assert.Equal(0, removed);   // 目录被占用：删不掉
            Assert.True(Directory.Exists(WsDir("locked")));
        }
        else
        {
            Assert.True(removed >= 0);  // Linux 允许删除被打开的文件，这里只要求不抛异常
        }
    }

    [Fact]
    public async Task CloneOnlySuccess_TriggersCleanup_AndKeepsItself()
    {
        await SeedTask("old1", completedAt: DateTime.UtcNow.AddHours(-1));
        await SeedTask("old2", completedAt: DateTime.UtcNow.AddHours(-2));
        MakeWorkspace("old1"); MakeWorkspace("old2");

        // keep=1：新克隆的任务保住，另外只留最近的一个旧任务，多出来的 old2 被清掉
        var result = await Create(WsRoot, keep: "1")
            .SubmitCloneOnly("zip", WikiGeneratorService.EncodeZipSource(MakeZip()), "p", "公共", 1, "public");

        Assert.True(result.Ok, result.Message);
        Assert.False(Directory.Exists(WsDir("old2")));         // 保留策略被触发
        Assert.True(Directory.Exists(WsDir("old1")));
        Assert.True(Directory.Exists(WsDir(result.Task!.Id))); // 新工作区一定在
    }

    [Fact]
    public async Task RecloneSuccess_TriggersCleanup_ButKeepsTheRestoredWorkspace()
    {
        // 三个比它新的任务 + 一个很老的（工作区已丢失、准备重新克隆）
        await SeedTask("newer1", completedAt: DateTime.UtcNow);
        await SeedTask("newer2", completedAt: DateTime.UtcNow.AddMinutes(-1));
        await SeedTask("newer3", completedAt: DateTime.UtcNow.AddMinutes(-2));
        Db.WikiTasks.Add(new WikiTask
        {
            Id = "old-task", Type = "zip", SourceUrl = WikiGeneratorService.EncodeZipSource(MakeZip()),
            ProjectName = "old", TargetFolder = "公共", Status = "completed",
            CompletedAt = DateTime.UtcNow.AddHours(-10),
        });
        await Db.SaveChangesAsync();
        MakeWorkspace("newer1"); MakeWorkspace("newer2"); MakeWorkspace("newer3");
        Assert.False(Directory.Exists(WsDir("old-task")));   // 工作区已丢失

        // keep=2：newer1 + 刚恢复的 old-task 留下，newer3 被清掉
        var result = await Create(WsRoot, keep: "2").CloneWorkspaceOnly("old-task");

        Assert.True(result.Ok, result.Message);
        Assert.True(Directory.Exists(WsDir("old-task")));   // 关键：刚「重新克隆」的不能立刻被自己触发的清理删掉
        Assert.True(Directory.Exists(WsDir("newer1")));
        Assert.False(Directory.Exists(WsDir("newer3")));
    }
}
