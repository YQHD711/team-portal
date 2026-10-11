using TeamPortal.Services;

namespace api;

/// <summary>
/// 中英桥接 sidecar 的纯逻辑：英文判定（规格口径：无 CJK 或 ASCII 占比 &gt; 70%）、
/// AI 一行 JSON 的解析、sidecar 的读写与回读。检索侧怎么用它见 KnowledgeBridgingIndexTests。
/// </summary>
public class KnowledgeBridgeTests
{
    [Theory]
    [InlineData("TECS circle radius is determined by bank angle and groundspeed.", true)]
    [InlineData("盘旋半径由滚转角和地速决定。", false)]
    [InlineData("", false)]
    [InlineData("   \n\t ", false)]
    public void IsEnglishText_FollowsSpecRule(string text, bool expected)
        => Assert.Equal(expected, KnowledgeBridge.IsEnglishText(text));

    [Fact]
    public void IsEnglishText_NoCjkIsEnglish_EvenWithMostlyNumbers()
        => Assert.True(KnowledgeBridge.IsEnglishText("12345 67890 !!!"));   // 无 CJK → 英文

    [Fact]
    public void IsEnglishText_MostlyAsciiWithSomeChinese_IsStillEnglish()
    {
        // ASCII 占比 > 70%：英文档里夹几句中文注释，仍按英文处理
        var text = "The TECS controller adjusts throttle and pitch. " + new string('a', 300) + " 注：这是补充说明。";
        Assert.True(KnowledgeBridge.IsEnglishText(text));
    }

    [Fact]
    public void ParseSummary_AcceptsOneLineJson_WithProseAndCodeFence()
    {
        var raw = "好的，结果如下：\n```json\n{\"t\":\"导航TECS原理\",\"k\":[\"盘旋半径\",\"TECS\",\"滚转角\"],\"d\":\"说明盘旋半径由滚转角与地速决定\"}\n```";

        var parsed = KnowledgeBridge.ParseSummary(raw);

        Assert.NotNull(parsed);
        Assert.Equal("导航TECS原理", parsed!.Value.Title);
        Assert.Equal(["盘旋半径", "TECS", "滚转角"], parsed.Value.Keywords);
        Assert.Contains("滚转角", parsed.Value.Summary);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("模型这次没有按要求输出")]
    [InlineData("{}")]                                  // 三个字段都没有 → 视为失败
    [InlineData("{\"t\":\"标题\",\"k\":\"不是数组\",\"d\":\"摘要\"}")]  // 字段类型不对也不算全失败
    public void ParseSummary_HandlesBadOutput(string? raw)
    {
        var parsed = KnowledgeBridge.ParseSummary(raw);
        if (raw == "{\"t\":\"标题\",\"k\":\"不是数组\",\"d\":\"摘要\"}")
            Assert.Equal("标题", parsed!.Value.Title);   // 容忍坏字段，标题摘要在就行
        else
            Assert.Null(parsed);
    }

    [Fact]
    public void Sidecar_RoundTrip_KeepsSourcePathAndText()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"tp-bridge-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var sidecar = Path.Combine(dir, "plane.md.zhidx.json");
            File.WriteAllText(sidecar, KnowledgeBridge.BuildJson("公共/plane.md", "导航TECS", ["盘旋半径", "TECS"], "一句话摘要"));

            Assert.Equal("公共/plane.md", KnowledgeBridge.TryReadSourcePath(sidecar));
            var indexText = KnowledgeBridge.TryReadIndexText(sidecar);
            Assert.NotNull(indexText);
            Assert.Contains("导航TECS", indexText);
            Assert.Contains("盘旋半径", indexText);
            Assert.Contains("一句话摘要", indexText);
            Assert.DoesNotContain("{", indexText);   // 索引里不要 JSON 花括号噪音
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void TryReadIndexText_MissingOrBroken_ReturnsNullNotThrow()
    {
        Assert.Null(KnowledgeBridge.TryReadIndexText(Path.Combine(Path.GetTempPath(), "no-such.zhidx.json")));

        var dir = Path.Combine(Path.GetTempPath(), $"tp-bridge-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var broken = Path.Combine(dir, "x.md.zhidx.json");
            File.WriteAllText(broken, "{\"t\": 这不合法");
            Assert.Null(KnowledgeBridge.TryReadIndexText(broken));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void IsSidecar_AndPathFor()
    {
        Assert.True(KnowledgeBridge.IsSidecar("公共/a.md.zhidx.json"));
        Assert.True(KnowledgeBridge.IsSidecar("公共/A.MD.ZHIDX.JSON"));
        Assert.False(KnowledgeBridge.IsSidecar("公共/a.md"));
        Assert.Equal("公共/a.md.zhidx.json", KnowledgeBridge.SidecarPathFor("公共/a.md"));
    }
}
