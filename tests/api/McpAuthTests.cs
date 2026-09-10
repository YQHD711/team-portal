using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using TeamPortal.Mcp;

namespace api;

/// <summary>
/// MCP 工具的权限基元。/mcp 端点只要求"已认证",每个工具必须自己比对
/// 与 HTTP 端点同等的 AdminOnly/StaffOnly 策略,这里验证取值逻辑。
/// </summary>
public class McpAuthTests
{
    private static IHttpContextAccessor Accessor(string? role, string? dept = null, int? userId = null)
    {
        var claims = new List<Claim>();
        if (role is not null) claims.Add(new Claim(ClaimTypes.Role, role));
        if (dept is not null) claims.Add(new Claim("Department", dept));
        if (userId is not null) claims.Add(new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString()));
        var ctx = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
        return new HttpContextAccessor { HttpContext = ctx };
    }

    [Theory]
    [InlineData("admin", true, true)]
    [InlineData("部长", true, false)]
    [InlineData("member", false, false)]
    [InlineData("guest", false, false)]
    public void RoleChecks(string role, bool staff, bool admin)
    {
        var http = Accessor(role);

        Assert.Equal(staff, McpAuth.IsStaff(http));
        Assert.Equal(admin, McpAuth.IsAdmin(http));
    }

    [Fact]
    public void MissingContextOrClaims_AreNotPrivileged()
    {
        var empty = new HttpContextAccessor();

        Assert.False(McpAuth.IsAdmin(empty));
        Assert.False(McpAuth.IsStaff(empty));
        Assert.Null(McpAuth.Role(empty));
        Assert.Equal(0, McpAuth.UserId(empty));
    }

    [Fact]
    public void UserIdAndDepartment_ComeFromClaims()
    {
        var http = Accessor("部长", "飞训部", 42);

        Assert.Equal(42, McpAuth.UserId(http));
        Assert.Equal("飞训部", McpAuth.Department(http));
    }
}
