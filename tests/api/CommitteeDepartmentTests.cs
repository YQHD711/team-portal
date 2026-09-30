using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace api;

/// <summary>
/// 「管理委员会」：给管理员一个部门属性，**纯粹是名号与归属展示，不改动权限分级**。
///
/// 为什么要有测试盯着"权限没变"：系统里多处按**部门**做数据范围判断
/// （部长只能管/看本部门、物料按部门流转、Wiki 按 TargetFolder 比对部门名）。
/// 给管理员塞一个部门，只要有一处忘了先按 role 短路，就会悄悄改变管理员的权限。
/// </summary>
public class CommitteeDepartmentTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public CommitteeDepartmentTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private HttpClient Client(string dbPath) => _factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("ConnectionStrings:DefaultConnection", $"Data Source={dbPath}");
        b.UseSetting("Jwt:Key", new string('k', 40));
        b.UseSetting("Jwt:Issuer", "TeamPortal");
        b.UseSetting("Jwt:Audience", "TeamPortal");
        // 让启动时的 SeedAdmin 真的建出管理员 —— 管理委员会的分配正是在那之后跑的
        b.UseSetting("Admin:Username", "boss");
        b.UseSetting("Admin:Password", "pw123456");
    }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static DbContextOptions<AppDbContext> Options(string dbPath)
        => new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={dbPath}").Options;

    [Fact]
    public async Task Admin_GetsCommitteeDepartment_WithoutRoleChange()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-committee-{Guid.NewGuid():N}.db");
        try
        {
            _ = Client(dbPath); // 触发一次启动，跑完迁移与种子

            await using var db = new AppDbContext(Options(dbPath));
            var committee = await db.Departments.FirstOrDefaultAsync(d => d.Name == "管理委员会");
            Assert.NotNull(committee);

            var admin = await db.Users.SingleAsync(u => u.Username == "boss");
            Assert.Equal("admin", admin.Role);              // 角色没变
            Assert.Equal(committee!.Id, admin.DepartmentId); // 但有了部门属性
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task CommitteeDepartment_IsNotCreatedTwice_AndDoesNotOverwriteManualAssignment()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-committee-{Guid.NewGuid():N}.db");
        try
        {
            _ = Client(dbPath);
            int committeeId;
            await using (var db = new AppDbContext(Options(dbPath)))
                committeeId = (await db.Departments.SingleAsync(d => d.Name == "管理委员会")).Id;

            // 把管理员手动改到别的部门 + 重启
            var otherDept = new Department { Name = "飞训部" };
            await using (var db = new AppDbContext(Options(dbPath)))
            {
                db.Departments.Add(otherDept);
                await db.SaveChangesAsync();   // 先落库：否则 otherDept.Id 还是 0
                var admin = await db.Users.SingleAsync(u => u.Username == "boss");
                admin.DepartmentId = otherDept.Id;
                await db.SaveChangesAsync();
            }
            _ = Client(dbPath);

            await using (var db = new AppDbContext(Options(dbPath)))
            {
                Assert.Single(db.Departments.Where(d => d.Name == "管理委员会")); // 幂等，不重复建
                var admin = await db.Users.SingleAsync(u => u.Username == "boss");
                Assert.Equal(otherDept.Id, admin.DepartmentId);  // 不覆盖手动设置
                Assert.NotEqual(committeeId, admin.DepartmentId);
            }
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    [Fact]
    public async Task CommitteeAdmin_StillHasFullAdminPowers()
    {
        // 关键回归：管理员在"比对部门"之前就按 role 短路，所以被塞进部门不会改变权限。
        // 这里用「跨部门查看档案」来验证 —— 部长做这件事会被拒，管理员不会。
        var dbPath = Path.Combine(Path.GetTempPath(), $"tp-committee-{Guid.NewGuid():N}.db");
        try
        {
            var client = Client(dbPath);

            string targetSlug = "u_target0001abcd";
            await using (var db = new AppDbContext(Options(dbPath)))
            {
                var committeeId = (await db.Departments.SingleAsync(d => d.Name == "管理委员会")).Id;
                var other = new Department { Name = "飞训部" };
                db.Departments.Add(other);
                await db.SaveChangesAsync();

                // 目标成员在别的部门，且刻意与管理员不在同一部门
                db.Users.Add(new User
                {
                    Username = "target", PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
                    Role = "member", Slug = targetSlug, DepartmentId = other.Id,
                });
                await db.SaveChangesAsync();
                Assert.NotEqual(committeeId, other.Id);
            }

            var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "boss", password = "pw123456" });
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var token = (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);

            // 管理员跨部门看档案：必须仍然放行（若哪天忘了按 role 短路，这里会变成 403）
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/admin/profiles/{targetSlug}")).StatusCode);
        }
        finally { try { File.Delete(dbPath); } catch { } }
    }

    private sealed record LoginResp(string Token);
}
