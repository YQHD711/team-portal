using TeamPortal.Services;

namespace api;

/// <summary>
/// 工作区根目录的来源（修 blob 404 根因）。
/// 默认 /data/wiki-workspaces（容器里 ./data:/data 是挂卷目录，重建容器不会丢），
/// 设置 Wiki:WorkspaceRoot 优先，其次配置，最后内置默认——本机/测试靠前两者指到临时目录。
/// </summary>
public class WikiWorkspaceRootTests : WikiWorkspaceTestBase
{
    [Fact]
    public async Task WorkspaceRoot_ComesFromSetting_NotTemp()
    {
        var dbRoot = Path.Combine(Tmp, "from-db");
        await SetSetting("Wiki:WorkspaceRoot", dbRoot);

        // 配置里指向另一个目录：设置（DB）必须优先，否则线上在设置页改了不生效
        var dir = await Create(WsRoot).WorkspaceDirAsync("t1");

        Assert.Equal(Path.Combine(dbRoot, "t1"), dir);
        Assert.DoesNotContain("teamportal-wiki", dir);  // 不再是原来的 /tmp/teamportal-wiki
    }

    [Fact]
    public async Task WorkspaceRoot_FallsBackToConfig_ThenBuiltInDefault()
    {
        Assert.StartsWith(WsRoot, await Create(WsRoot).WorkspaceDirAsync("t1"));
        Assert.Equal("/data/wiki-workspaces", WikiGeneratorService.DefaultWorkspaceRoot);
        Assert.Equal(WikiGeneratorService.DefaultWorkspaceRoot, await Create().ResolveWorkspaceRootAsync());
        // 内置默认落在挂卷目录 /data 下，绝不是 /tmp（重建容器不会丢）
        Assert.False(Path.GetFullPath(WikiGeneratorService.DefaultWorkspaceRoot).StartsWith(Path.GetTempPath()));
    }

    [Fact]
    public async Task CloneOnly_ReallyClonesIntoConfiguredRoot()
    {
        var result = await Create(WsRoot)
            .SubmitCloneOnly("zip", WikiGeneratorService.EncodeZipSource(MakeZip()), "p", "公共", 1, "public");

        Assert.True(result.Ok, result.Message);
        Assert.StartsWith(WsRoot, result.Task!.WorkspacePath);   // 真落到了设置指定的根目录
        Assert.True(File.Exists(Path.Combine(WsDir(result.Task.Id), "repo", "a.h")));
    }

    [Fact]
    public async Task KeepDefault_IsTwenty()
    {
        Assert.Equal(20, WikiGeneratorService.DefaultWorkspaceKeep);
        Assert.Equal(20, await Create(WsRoot).ResolveWorkspaceKeepAsync());
        Assert.Equal(1, await Create(WsRoot, keep: "0").ResolveWorkspaceKeepAsync()); // 下限 1，不允许「一个都不留」
    }
}
