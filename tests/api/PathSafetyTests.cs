using TeamPortal.Services;

namespace api;

/// <summary>
/// 路径与外部命令参数安全:git clone 仓库地址白名单。
/// 直接消费用户输入,旧实现是命令行拼接。
///
/// 说明:飞行日志文件名解析(`FlightLogService.ResolveSafePath`)的用例已随"日志上传功能删除"
/// 一并移除 —— 被测类型已不存在。知识库/Wiki 侧各自的路径防护另有测试覆盖。
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
}
