using TeamPortal.Services;

namespace api;

/// <summary>
/// task-17 的服务端校验清单：尺寸/DPI/元素数/越界/唯一 id/type/7 个 field/字号/字重/颜色/对齐/静区。
/// 这些规则挡在写库之前，前端设计器再好也不能替代（绕过前端直接打接口时必须被拒）。
/// </summary>
public class LabelTemplateValidationTests
{
    [Fact]
    public void AcceptsBuiltInDefault_AndBoundaryValues()
    {
        Assert.Null(LabelTemplateValidation.Validate(LabelTemplateValidation.BuiltInDefault()));

        // 边界值：正好 10/300、50 个元素、4..72、100..900 都应该通过
        Assert.Null(LabelTemplateValidation.Validate(new LabelTemplateDto
        {
            Name = "边界", WidthMm = 10, HeightMm = 300, Dpi = 203, Background = "#abcdef",
            Elements = Enumerable.Range(1, LabelTemplateValidation.MaxElements)
                .Select(i => LabelTemplateTestData.El($"e{i}", "text", 0, 0, 5, 5, null, 4)).ToList(),
        }));

        // 二维码不带 field、静区为空也合法
        Assert.Null(LabelTemplateValidation.Validate(new LabelTemplateDto
        {
            Name = "只有码", WidthMm = 40, HeightMm = 40, Dpi = 300, Background = "#FFFFFF",
            Elements = [LabelTemplateTestData.El("qr", "qr", 1, 1, 38, 38)],
        }));
    }

    [Fact]
    public void RejectsEveryListedRule()
    {
        var cases = new (string Name, Action<LabelTemplateDto> Break)[]
        {
            ("name 为空", t => t.Name = "  "),
            ("width 太小", t => t.WidthMm = 9),
            ("width 太大", t => t.WidthMm = 301),
            ("height 太小", t => t.HeightMm = 9),
            ("height 太大", t => t.HeightMm = 301),
            ("dpi 不在集合", t => t.Dpi = 120),
            ("background 非 #RRGGBB", t => t.Background = "white"),
            ("元素超 50 个", t => t.Elements = Enumerable.Range(1, 51).Select(i => LabelTemplateTestData.El($"e{i}", "text", 0, 0, 1, 1)).ToList()),
            ("id 为空", t => t.Elements[0].Id = ""),
            ("id 重复", t => t.Elements[1].Id = t.Elements[0].Id),
            ("type 非法", t => t.Elements[0].Type = "image"),
            ("w 为 0", t => t.Elements[0].W = 0),
            ("h 为负", t => t.Elements[0].H = -2),
            ("x 为负", t => t.Elements[0].X = -1),
            ("y 为负", t => t.Elements[0].Y = -0.5),
            ("超出右边界", t => t.Elements[0].X = 70),
            ("超出下边界", t => t.Elements[0].Y = 48),
            ("qr 带 field", t => t.Elements[0].Field = "code"),
            ("qr 静区过大", t => t.Elements[0].QuietMm = 20),
            ("qr 静区为负", t => t.Elements[0].QuietMm = -1),
            ("field 不在 7 个之内", t => t.Elements[1].Field = "quantity"),
            ("fontSizePt 过小", t => t.Elements[1].FontSizePt = 3),
            ("fontSizePt 过大", t => t.Elements[1].FontSizePt = 73),
            ("fontWeight 越界", t => t.Elements[1].FontWeight = 50),
            ("fontWeight 超上限", t => t.Elements[1].FontWeight = 1000),
            ("fontFamily 非法", t => t.Elements[1].FontFamily = "serif"),
            ("color 非 #RRGGBB", t => t.Elements[1].Color = "#12345"),
            ("color 缺 #", t => t.Elements[1].Color = "111111"),
            ("align 非法", t => t.Elements[1].Align = "justify"),
        };

        foreach (var (name, broken) in cases)
        {
            var t = LabelTemplateTestData.New("模板");
            broken(t);
            Assert.True(LabelTemplateValidation.Validate(t) is not null, $"应该拒绝：{name}");
        }
    }

    [Fact]
    public void AllowsExactlySevenFields_IncludingCompositeMeta()
    {
        foreach (var field in LabelTemplateValidation.Fields)
        {
            var t = LabelTemplateTestData.New("字段");
            t.Elements[1].Field = field;
            Assert.Null(LabelTemplateValidation.Validate(t));
        }

        Assert.Equal(7, LabelTemplateValidation.Fields.Length);
        Assert.Contains("meta", LabelTemplateValidation.Fields);
        Assert.Equal(["code", "name", "grade", "locationCode", "category", "url", "meta"], LabelTemplateValidation.Fields);
    }
}
