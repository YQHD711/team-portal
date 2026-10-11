using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using TeamPortal.Services;

namespace api;

/// <summary>task-17 接口层：权限（GET 任意登录 / 写入 AdminOnly）、种子默认模板、Admin CRUD 往返。</summary>
public class LabelTemplateEndpointTests : LabelTemplateEndpointTestBase
{
    public LabelTemplateEndpointTests(WebApplicationFactory<Program> factory) : base(factory) { }

    [Fact]
    public async Task Get_RequiresAuthentication()
    {
        var dbPath = NewDbPath();
        try
        {
            var res = await NewClient(dbPath).GetAsync("/api/label-templates");
            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Get_MemberSeesSeededDefaultTemplate()
    {
        var dbPath = NewDbPath();
        try
        {
            var client = await LoginAsync(dbPath, "labelmember", "member");
            var t = Assert.Single(await ListAsync(client));

            Assert.True(t.IsDefault);
            Assert.Equal("默认 80×50", t.Name);
            Assert.Equal((80d, 50d, 600), (t.WidthMm, t.HeightMm, t.Dpi));
            Assert.Equal(5, t.Elements.Count);
            Assert.Contains(t.Elements, e => e.Field == "meta");
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Writes_AreAdminOnly()
    {
        var dbPath = NewDbPath();
        try
        {
            var member = await LoginAsync(dbPath, "labelmember2", "member");
            var id = (await ListAsync(member)).Single().Id;

            Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync("/api/label-templates", LabelTemplateTestData.Sample())).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync($"/api/label-templates/{id}", LabelTemplateTestData.Sample())).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.DeleteAsync($"/api/label-templates/{id}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync($"/api/label-templates/{id}/default", null)).StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task Admin_Crud_RoundTrips()
    {
        var dbPath = NewDbPath();
        try
        {
            var admin = await LoginAsync(dbPath, "labeladmin", "admin");

            var create = await admin.PostAsJsonAsync("/api/label-templates", LabelTemplateTestData.Sample());
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var created = (await create.Content.ReadFromJsonAsync<LabelTemplateDto>())!;
            Assert.True(created.Id > 0);
            Assert.False(created.IsDefault);                     // 已经有种子默认了，新建的不是默认
            Assert.Equal(2, created.Elements.Count);
            Assert.Equal("meta", created.Elements[1].Field);

            var update = await admin.PutAsJsonAsync($"/api/label-templates/{created.Id}", LabelTemplateTestData.Sample("改名了"));
            Assert.Equal(HttpStatusCode.OK, update.StatusCode);
            var updated = (await update.Content.ReadFromJsonAsync<LabelTemplateDto>())!;
            Assert.Equal("改名了", updated.Name);
            Assert.Equal(created.Id, updated.Id);
            Assert.Equal(2, (await ListAsync(admin)).Count);

            var del = await admin.DeleteAsync($"/api/label-templates/{created.Id}");
            Assert.Equal(HttpStatusCode.OK, del.StatusCode);
            var deleted = (await del.Content.ReadFromJsonAsync<DeleteResp>())!;
            Assert.True(deleted.Ok);
            Assert.Single(await ListAsync(admin));
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }
}
