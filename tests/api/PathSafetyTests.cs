using Microsoft.Extensions.Configuration;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 路径与外部命令参数安全:git clone 仓库地址白名单、飞行日志文件名解析。
/// 两者都直接消费用户输入,旧实现分别是命令行拼接与 Path.Combine 裸拼。
/// </summary>
public class PathSafetyTests
{
    [Theory]
    [InlineData("https://github.com/a/b.git")]
    [InlineData("http://example.com/x.zip")]
    public void ValidateCloneUrl_AllowsHttpSchemes(string url)
        => Assert.StartsWith("http", WikiGeneratorService.ValidateCloneUrl(url));

    [Theory]
    [InlineData("ext::sh -c 'id>/tmp/pwn'")]   // git ext 传输 = 直接执行命令
    [InlineData("file:///etc/passwd")]         // 本地文件读取
    [InlineData("--upload-pack=/tmp/x")]       // 参数注入
    [InlineData("git@github.com:a/b.git")]     // scp 形式,不是合法绝对 URL
    [InlineData("")]
    [InlineData("   ")]
    public void ValidateCloneUrl_RejectsEverythingElse(string url)
        => Assert.ThrowsAny<Exception>(() => WikiGeneratorService.ValidateCloneUrl(url));

    private static FlightLogService FlightLogSvc(string dir)
        => new(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["FlightLogs:Dir"] = dir })
            .Build());

    [Theory]
    [InlineData("flight.tlog", true)]
    [InlineData("..\\..\\..\\evil.tlog", false)]
    [InlineData("../../evil.tlog", false)]
    [InlineData("sub/evil.tlog", false)]
    [InlineData("sub\\evil.tlog", false)]
    [InlineData(".hidden.tlog", false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void ResolveSafePath_RejectsEscapes(string name, bool allowed)
    {
        var dir = Path.Combine(Path.GetTempPath(), $"tp-flightlogs-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);

        var resolved = FlightLogSvc(dir).ResolveSafePath(name);

        Assert.Equal(allowed, resolved is not null);
        if (resolved is not null)
            Assert.StartsWith(Path.GetFullPath(dir), resolved, StringComparison.OrdinalIgnoreCase);
    }
}
