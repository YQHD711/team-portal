using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using TeamPortal.Mcp;

namespace api;

/// <summary>
/// 审计 #2/#3/#9：MCP 工具与对应 HTTP 端点的**授权对齐**。
///
/// `/mcp` 只要求"已认证"，所以每个工具必须自己比对 HTTP 侧策略。
/// 这里专门盯住几个曾经漏判的写操作 —— 成员一旦能调，就是越权：
///  - `material_checkin`：HTTP 要求 staff（`MaterialEndpoints.cs:183`），漏判 → 成员可代他人归还并回加库存
///  - `material_list_stocktakes`：HTTP 要求 staff（`:220`）
///  - `profile_training_add` / `profile_competition_add`：HTTP 在 `/api/admin/profiles` 组内 → 成员可给自己写成绩
///
/// 手法：传 null 服务实例。若权限判定在**触碰服务之前**就返回 Forbidden，说明守卫存在；
/// 若漏判则会抛 NullReferenceException —— 正是我们要阻止的那种"能走到业务逻辑"。
/// </summary>
public class McpToolAuthorizationTests
{
    private static IHttpContextAccessor Accessor(string role, int userId = 7)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.Role, role),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
        };
        var ctx = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
        return new HttpContextAccessor { HttpContext = ctx };
    }

    [Theory]
    [InlineData("member")]
    [InlineData("guest")]
    public async Task MaterialCheckin_MemberIsForbidden(string role)
    {
        var tools = new MaterialTools(null!, Accessor(role));
        var result = await tools.Checkin(1, "normal", hasPhoto: true);
        Assert.Equal(McpAuth.Forbidden, result);
    }

    [Fact]
    public async Task MaterialCheckin_StaffReachesService()
    {
        // staff 通过守卫后才会触碰服务 → 这里 null 服务会 NRE，正好证明"判权在业务之前"
        var tools = new MaterialTools(null!, Accessor("部长"));
        await Assert.ThrowsAsync<NullReferenceException>(() => tools.Checkin(1, "normal", hasPhoto: true));
    }

    [Theory]
    [InlineData("member")]
    [InlineData("guest")]
    public async Task MaterialListStocktakes_MemberIsForbidden(string role)
    {
        var tools = new MaterialTools(null!, Accessor(role));
        Assert.Equal(McpAuth.Forbidden, await tools.ListStocktakes());
    }

    [Theory]
    [InlineData("member")]
    [InlineData("guest")]
    public async Task ProfileTrainingAdd_MemberIsForbidden(string role)
    {
        var tools = new ProfileTools(null!, Accessor(role));
        Assert.Equal(McpAuth.Forbidden, await tools.TrainingAdd("无人机执照"));
    }

    [Theory]
    [InlineData("member")]
    [InlineData("guest")]
    public async Task ProfileCompetitionAdd_MemberIsForbidden(string role)
    {
        var tools = new ProfileTools(null!, Accessor(role));
        Assert.Equal(McpAuth.Forbidden, await tools.CompetitionAdd("省赛"));
    }

    [Fact]
    public async Task AdminCreateUser_NowRequiresAdmin_NotMinister()
    {
        // 审计 #2：HTTP `POST /api/admin/users` 是 AdminOnly，MCP 之前允许「部长」→ 提权
        var tools = new AdminTools(null!, Accessor("部长", 9));
        Assert.Equal(McpAuth.Forbidden, await tools.CreateUser("x", "pw123456"));
    }
}
