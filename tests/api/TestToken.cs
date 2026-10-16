using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace api;

/// <summary>
/// 直接签发测试用 JWT（照 <c>FinanceDeleteAuthorizationTests.MakeToken</c> 的既有写法）。
///
/// 为什么不在测试里调 `POST /api/auth/login`：登录限流是 **5 次/60 秒/IP**，而 TestServer 默认
/// 所有请求的对端都是 127.0.0.1 —— 测试类一多就互相把对方打成 429（本仓库实测踩到：
/// 新增测试后别的类的登录变 Unauthorized）。直接签发 token 完全不碰限流桶。
/// </summary>
internal static class TestToken
{
    /// <summary>测试统一使用的 JWT 密钥（各测试用 UseSetting("Jwt:Key", JwtKey) 对齐）</summary>
    public const string JwtKey = "test-jwt-key-0123456789-0123456789-abc";

    public static string Make(int userId, string username, string role)
    {
        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: "TeamPortal",
            audience: "TeamPortal",
            claims:
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Name, username),
                new Claim(ClaimTypes.Role, role),
            ],
            expires: DateTime.UtcNow.AddDays(1),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
