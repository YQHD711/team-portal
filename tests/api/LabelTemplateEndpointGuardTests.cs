using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-17 接口层的守卫：非法输入 400 且**不写坏已有模板**、删默认自动提升、
/// 未知 id 404、空表不 500。
/// </summary>
public class LabelTemplateEndpointGuardTests : LabelTemplateEndpointTestBase
{
    public LabelTemplateEndpointGuardTests(WebApplicationFactory<Program> factory) : base(factory) { }

    [Fact]
    public async Task InvalidInput_Returns400_AndLeavesExistingTemplateIntact()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "labeladmin2", "admin");
            var before = (await ListAsync(admin)).Single();

            var bad = LabelTemplateTestData.Sample("不该存进去");
            bad.WidthMm = 9;                                     // 尺寸越界
            var res = await admin.PutAsJsonAsync($"/api/label-templates/{before.Id}", bad);
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
            Assert.Contains("widthMm", await res.Content.ReadAsStringAsync());

            var outOfBounds = LabelTemplateTestData.Sample("元素越界");
            outOfBounds.Elements[0].X = 55;                      // x+w > widthMm
            var res2 = await admin.PutAsJsonAsync($"/api/label-templates/{before.Id}", outOfBounds);
            Assert.Equal(HttpStatusCode.BadRequest, res2.StatusCode);
            Assert.Contains("超出", await res2.Content.ReadAsStringAsync());

            var badField = LabelTemplateTestData.Sample("怪字段");
            badField.Elements[1].Field = "quantity";
            Assert.Equal(HttpStatusCode.BadRequest,
                (await admin.PostAsJsonAsync("/api/label-templates", badField)).StatusCode);

            var noName = new LabelTemplateDto { Name = "", WidthMm = 80, HeightMm = 50, Dpi = 600, Elements = [] };
            Assert.Equal(HttpStatusCode.BadRequest,
                (await admin.PostAsJsonAsync("/api/label-templates", noName)).StatusCode);

            var after = (await ListAsync(admin)).Single();        // 存量模板一位不动
            Assert.Equal(before.Id, after.Id);
            Assert.Equal(before.Name, after.Name);
            Assert.Equal(before.WidthMm, after.WidthMm);
            Assert.Equal(before.Elements.Count, after.Elements.Count);
            Assert.True(after.IsDefault);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task SetDefault_ThenDeleteDefault_PromotesAnother()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "labeladmin3", "admin");
            var seed = (await ListAsync(admin)).Single();

            var mine = (await (await admin.PostAsJsonAsync("/api/label-templates", LabelTemplateTestData.Sample()))
                .Content.ReadFromJsonAsync<LabelTemplateDto>())!;
            var setDefault = await admin.PostAsync($"/api/label-templates/{mine.Id}/default", null);
            Assert.Equal(HttpStatusCode.OK, setDefault.StatusCode);
            var def = (await setDefault.Content.ReadFromJsonAsync<LabelTemplateDto>())!;
            Assert.True(def.IsDefault);
            Assert.Single(await ListAsync(admin), t => t.IsDefault);

            var del = await admin.DeleteAsync($"/api/label-templates/{mine.Id}");
            var body = (await del.Content.ReadFromJsonAsync<DeleteResp>())!;
            Assert.Equal(seed.Id, body.DefaultId);                // 自动提升回种子模板
            var left = await ListAsync(admin);
            Assert.Single(left);
            Assert.True(left[0].IsDefault);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task UnknownId_Returns404_AndEmptyTableIsNotAnError()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "labeladmin4", "admin");

            Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync("/api/label-templates/99999", LabelTemplateTestData.Sample())).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/api/label-templates/99999")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/label-templates/99999/default", null)).StatusCode);

            foreach (var t in await ListAsync(admin))             // 清空所有模板
                Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/label-templates/{t.Id}")).StatusCode);

            Assert.Empty(await ListAsync(admin));                 // 空表照样 200，不是一个错误
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
