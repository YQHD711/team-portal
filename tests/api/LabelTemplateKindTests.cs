using TeamPortal.Services;

namespace api;

/// <summary>
/// task-40 ③b：**库位标签模板适用性**（C# 侧）。
/// 与前端 `web/lib/labelSuitability.ts` 是**跨语言重复实现** → 用**共享 fixture 用例标识**防漂移：
///   case:valid / case:missing-qr / case:qr-without-code-text / case:no-text / case:empty
/// 两侧（此处 + `web/tests/label-suitability.test.ts`）都用这五个 id 断言；
/// **冲突时以更严格的一侧为准并同步另一侧**（当前两侧规则一致）。
/// </summary>
public class LabelTemplateKindTests
{
    private static LabelElementDto El(string type, string? field = null) => new()
    {
        Id = Guid.NewGuid().ToString("N")[..8], Type = type, X = 1, Y = 1, W = 10, H = 10, Field = field,
    };

    private static LabelElementDto[] Case(string id) => id switch
    {
        "case:valid" => [El("qr"), El("text", "code")],
        "case:missing-qr" => [El("text", "code")],
        "case:qr-without-code-text" => [El("qr"), El("text", "name")],
        "case:no-text" => [El("qr")],
        "case:empty" => [],
        _ => throw new ArgumentOutOfRangeException(nameof(id), id, "未知 fixture 用例"),
    };

    [Theory]
    [InlineData("case:valid", true)]
    [InlineData("case:missing-qr", true)]
    [InlineData("case:qr-without-code-text", false)]
    [InlineData("case:no-text", false)]
    [InlineData("case:empty", false)]
    public void Location_Suitability_SharedFixture(string id, bool expectedOk)
    {
        var reasons = LabelTemplateSuitability.Check(LabelTemplateSuitability.Location, Case(id));
        Assert.Equal(expectedOk, reasons.Count == 0);
        if (!expectedOk) Assert.NotEmpty(reasons);
    }

    [Fact]
    public void Material_Kind_Is_Not_Constrained()
        => Assert.Empty(LabelTemplateSuitability.Check(LabelTemplateSuitability.Material, Case("case:missing-qr")));

    [Fact]
    public void Normalize_OldTemplate_WithoutKind_Becomes_Material()
    {
        Assert.Equal("material", LabelTemplateSuitability.Normalize(null));
        Assert.Equal("material", LabelTemplateSuitability.Normalize(""));
        Assert.Equal("material", LabelTemplateSuitability.Normalize("MATERIAL"));
        Assert.Equal("location", LabelTemplateSuitability.Normalize("location"));
        Assert.Equal("material", LabelTemplateSuitability.Normalize("unknown-kind"));
    }

    [Fact]
    public void Qr_With_LocationCode_Text_Is_Also_Valid()
        => Assert.Empty(LabelTemplateSuitability.Check(LabelTemplateSuitability.Location, new[] { El("qr"), El("text", "locationCode") }));
}
