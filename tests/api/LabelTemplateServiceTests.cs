using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-17 种子 + CRUD + 默认模板不变量（校验清单见 <see cref="LabelTemplateValidationTests"/>）。
/// 全程本地（内存 sqlite），不碰 HTTP/AI。
/// </summary>
public class LabelTemplateServiceTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly LabelTemplateService _svc;

    public LabelTemplateServiceTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
        _svc = new LabelTemplateService(_db);
    }

    public void Dispose() { _db.Dispose(); GC.SuppressFinalize(this); }

    [Fact]
    public async Task Seed_BuildsLayoutEquivalentToOldHardcodedOne()
    {
        Assert.True(await _svc.SeedDefaultIfEmptyAsync());
        Assert.False(await _svc.SeedDefaultIfEmptyAsync());   // 幂等

        var t = Assert.Single(await _svc.ListAsync());
        Assert.Equal("默认 80×50", t.Name);
        Assert.True(t.IsDefault);
        Assert.Equal((80d, 50d, 600, "#FFFFFF"), (t.WidthMm, t.HeightMm, t.Dpi, t.Background));

        // 元素：二维码 + 四行文字，坐标/字号/字体/颜色与改造前逐一对应
        Assert.Equal(5, t.Elements.Count);
        var qr = t.Elements.Single(e => e.Type == "qr");
        Assert.Equal((3d, 10d, 30d, 30d), (qr.X, qr.Y, qr.W, qr.H));
        Assert.Equal(3, qr.QuietMm);
        Assert.Null(qr.Field);                                  // qr 不允许带 field

        var code = t.Elements.Single(e => e.Id == "code");
        Assert.Equal(("code", 14d, 6d, 12d, 700, "mono", "#111111", "center"),
            (code.Field, code.Y, code.H, code.FontSizePt, code.FontWeight, code.FontFamily, code.Color, code.Align));

        var name = t.Elements.Single(e => e.Id == "name");
        Assert.Equal(("name", 22d, 7d, 10d, 600), (name.Field, name.Y, name.H, name.FontSizePt, name.FontWeight));

        var meta = t.Elements.Single(e => e.Id == "meta");
        Assert.Equal(("meta", 29.5d, 5d, 8d, "#444444"), (meta.Field, meta.Y, meta.H, meta.FontSizePt, meta.Color));

        var url = t.Elements.Single(e => e.Id == "url");
        Assert.Equal(("url", 35.5d, 4.5d, 6.5d), (url.Field, url.Y, url.H, url.FontSizePt));

        // 文字都在右栏（x=36、宽 41 → 右边距 3mm），且种子自身必须过校验
        Assert.All(t.Elements.Where(e => e.Type == "text"), e => Assert.Equal((36d, 41d), (e.X, e.W)));
        Assert.Null(LabelTemplateValidation.Validate(t));
    }

    [Fact]
    public async Task Crud_RoundTripsElementsAndTouchesTimestamps()
    {
        var created = await _svc.CreateAsync(LabelTemplateTestData.New("自定义"), "admin");
        Assert.True(created.Id > 0);
        Assert.True(created.IsDefault);                       // 第一个模板自动成为默认
        Assert.NotEqual(default, created.UpdatedAt);

        var updated = await _svc.UpdateAsync(created.Id, new LabelTemplateDto
        {
            Name = "改过的", WidthMm = 60, HeightMm = 40, Dpi = 300, Background = "#EEEEEE",
            Elements =
            [
                LabelTemplateTestData.El("t1", "text", 1, 1, 20, 5, "meta", 9),
                LabelTemplateTestData.El("t2", "text", 1, 7, 20, 5, null, 4),
            ],
        }, "admin2");

        Assert.NotNull(updated);
        Assert.Equal("改过的", updated!.Name);
        Assert.Equal(300, updated.Dpi);
        Assert.Equal(2, updated.Elements.Count);
        Assert.Equal("meta", updated.Elements[0].Field);
        Assert.Equal(9, updated.Elements[0].FontSizePt);
        Assert.Equal("admin2", (await _db.LabelTemplates.AsNoTracking().SingleAsync(t => t.Id == created.Id)).UpdatedBy);

        // 读回来必须与写入一致（ElementsJson 保真）
        var reread = (await _svc.ListAsync()).Single(t => t.Id == created.Id);
        Assert.Equal(2, reread.Elements.Count);
        Assert.Equal(updated.Elements[0].Field, reread.Elements[0].Field);
        Assert.Equal(updated.Elements[1].FontSizePt, reread.Elements[1].FontSizePt);
        Assert.Null(reread.Elements[1].Field);                 // field 为空 → 走 text 字面量

        // 空元素模板也合法
        Assert.NotNull(await _svc.UpdateAsync(created.Id, new LabelTemplateDto { Name = "空的", Elements = [] }, "admin"));
        Assert.Empty((await _svc.ListAsync()).Single(t => t.Id == created.Id).Elements);
    }

    [Fact]
    public async Task Default_IsAlwaysUnique()
    {
        var a = await _svc.CreateAsync(LabelTemplateTestData.New("A"), "admin");
        var b = await _svc.CreateAsync(LabelTemplateTestData.New("B"), "admin");
        Assert.True(a.IsDefault);
        Assert.False(b.IsDefault);

        Assert.True((await _svc.SetDefaultAsync(b.Id))!.IsDefault);
        var all = await _svc.ListAsync();
        Assert.Single(all, t => t.IsDefault);
        Assert.False(all.Single(t => t.Id == a.Id).IsDefault);

        var back = await _svc.UpdateAsync(a.Id, new LabelTemplateDto { Name = "A2", IsDefault = true, Elements = [] }, "admin");
        Assert.True(back!.IsDefault);
        Assert.Single(await _svc.ListAsync(), t => t.IsDefault);

        Assert.Null(await _svc.SetDefaultAsync(999));
        Assert.Null(await _svc.UpdateAsync(999, LabelTemplateTestData.New("x"), "admin"));
    }

    [Fact]
    public async Task DeleteDefault_PromotesAnotherTemplate()
    {
        var a = await _svc.CreateAsync(LabelTemplateTestData.New("A"), "admin");
        var b = await _svc.CreateAsync(LabelTemplateTestData.New("B"), "admin");
        await _svc.CreateAsync(LabelTemplateTestData.New("C"), "admin");

        Assert.True(await _svc.DeleteAsync(a.Id));            // 删的是默认
        var all = await _svc.ListAsync();
        Assert.Equal(2, all.Count);
        Assert.True(all.Single(t => t.Id == b.Id).IsDefault); // 自动提升最早的另一个
        Assert.Single(all, t => t.IsDefault);

        Assert.False(await _svc.DeleteAsync(999));            // 找不到 → false（端点转 404）
    }

    [Fact]
    public async Task DeleteLastTemplate_LeavesEmptyList_NotThrowing()
    {
        var only = await _svc.CreateAsync(LabelTemplateTestData.New("唯一"), "admin");

        Assert.True(await _svc.DeleteAsync(only.Id));
        Assert.Empty(await _svc.ListAsync());                 // 允许"一个模板都没有"，前端用内置兜底版式
        Assert.True(await _svc.SeedDefaultIfEmptyAsync());    // 再启动一次会重新种下默认模板
        Assert.Single(await _svc.ListAsync());
    }

    [Fact]
    public async Task Deserialize_BrokenJsonDoesNotThrow()
    {
        _db.LabelTemplates.Add(new LabelTemplate
        {
            Name = "坏的", IsDefault = true, WidthMm = 80, HeightMm = 50, Dpi = 600,
            Background = "#FFFFFF", ElementsJson = "{不是数组",
        });
        await _db.SaveChangesAsync();

        var t = Assert.Single(await _svc.ListAsync());
        Assert.Empty(t.Elements);                              // 前端会退回内置兜底版式，而不是 500
    }
}
