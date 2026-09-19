using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 采购申请删除：仅管理员可删（部长/member 一律 403）。
/// 角色判定在服务端按数据库查（FinanceEndpoints.GetCtx），token 只负责身份（NameIdentifier）。
/// </summary>
public class FinanceDeleteAuthorizationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public FinanceDeleteAuthorizationTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private static string MakeToken(string jwtKey, int userId, string username, string role)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
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

    [Fact]
    public async Task Delete_RequiresAuth_MemberForbidden_AdminSucceeds()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-fin-delete-{Guid.NewGuid():N}.db");
        var jwtKey = new string('k', 40);
        var factory = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
            b.UseSetting("Jwt:Key", jwtKey);
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
        });
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        try
        {
            // 应用启动已完成 Migrate + seed，此时往同一文件库写入测试用户与一条采购申请。
            int memberId, adminId, requestId;
            var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;
            await using (var seed = new AppDbContext(opts))
            {
                var admin = new User { Username = "boss", PasswordHash = "x", Role = "admin" };
                var member = new User { Username = "member", PasswordHash = "x", Role = "member" };
                seed.Users.AddRange(admin, member);
                await seed.SaveChangesAsync();
                var req = new PurchaseRequest { RequesterUserId = member.Id, ItemName = "桨叶", Quantity = 1, EstimatedPrice = 120m, Reason = "x" };
                seed.PurchaseRequests.Add(req);
                await seed.SaveChangesAsync();
                adminId = admin.Id;
                memberId = member.Id;
                requestId = req.Id;
            }

            // 未登录 → 401（证明路由已注册且要求鉴权）
            var anon = new HttpRequestMessage(HttpMethod.Delete, $"/api/finance/requests/{requestId}");
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(anon)).StatusCode);

            // member → 403（角色由服务端查库判定，即使 token 带 admin role 也以 DB 为准；此处按真实 member 签发）
            var memberReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/finance/requests/{requestId}");
            memberReq.Headers.Authorization = new("Bearer", MakeToken(jwtKey, memberId, "member", "member"));
            var memberRes = await client.SendAsync(memberReq);
            Assert.Equal(HttpStatusCode.Forbidden, memberRes.StatusCode);

            // 403 不得留下任何回收站痕迹
            await using (var afterMember = new AppDbContext(opts))
                Assert.Empty(afterMember.TrashItems);

            // admin → 200，且记录被移除
            var adminReq = new HttpRequestMessage(HttpMethod.Delete, $"/api/finance/requests/{requestId}");
            adminReq.Headers.Authorization = new("Bearer", MakeToken(jwtKey, adminId, "boss", "admin"));
            var adminRes = await client.SendAsync(adminReq);
            Assert.Equal(HttpStatusCode.OK, adminRes.StatusCode);

            await using var verify = new AppDbContext(opts);
            Assert.Null(await verify.PurchaseRequests.FindAsync(requestId));
            // 软删除：内容进了回收站，管理员可恢复
            var trashed = await verify.TrashItems.SingleAsync();
            Assert.Equal("PurchaseRequest", trashed.OriginalTable);
            Assert.Equal(requestId, trashed.OriginalId);
            Assert.Equal("桨叶", trashed.Title);
        }
        finally
        {
            try { File.Delete(dbPath); } catch { }
        }
    }
}