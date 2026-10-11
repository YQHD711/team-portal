using TeamPortal.Services;

namespace api;

/// <summary>
/// 中英桥接 sidecar 的**读取/索引**侧（生成能力已在 task-13 整体移除）。
///
/// 保留这条路径的理由：线上从未真正生成过 sidecar（91 篇全量验证一直挂着），它是空转的、
/// 不改变任何行为，但与 P1-1 的分块索引（"桥接伪块"）耦合；已有 sidecar 的文档仍能靠它被中文命中。
/// 因此这里只钉"怎么认 sidecar、怎么把它的中文内容读出来"这两件事。
/// </summary>
public class KnowledgeBridgeTests
{
    [Fact]
    public void IsSidecar_AndPathFor()
    {
        Assert.True(KnowledgeBridge.IsSidecar("公共/a.md.zhidx.json"));
        Assert.True(KnowledgeBridge.IsSidecar("公共/A.MD.ZHIDX.JSON"));
        Assert.False(KnowledgeBridge.IsSidecar("公共/a.md"));
        Assert.Equal("公共/a.md.zhidx.json", KnowledgeBridge.SidecarPathFor("公共/a.md"));
    }

    [Fact]
    public void TryReadIndexText_ReadsTitleKeywordsAndSummary()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"tp-bridge-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            var sidecar = Path.Combine(dir, "plane.md.zhidx.json");
            File.WriteAllText(sidecar,
                """{"src":"公共/plane.md","t":"导航TECS","k":["盘旋半径","TECS"],"d":"一句话摘要"}""");

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

            var empty = Path.Combine(dir, "y.md.zhidx.json");
            File.WriteAllText(empty, "{}");
            Assert.Null(KnowledgeBridge.TryReadIndexText(empty));
        }
        finally { Directory.Delete(dir, true); }
    }
}
