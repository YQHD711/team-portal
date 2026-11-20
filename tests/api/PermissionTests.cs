using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeamPortal.Data;
using TeamPortal.Services.Permissions;

namespace api;

/// <summary>
/// 权限矩阵的服务层契约：默认矩阵、覆盖落库、与默认一致不落库、
/// 按角色恢复默认、角色之间互不串味。
///
/// 用内存 SQLite + 真实 AppDbContext，因为这里要验证的正是「怎么落库」这条契约，
/// 用假仓储会把最容易被写错的部分（覆盖行何时该存在）测成空壳。
/// </summary>
public class PermissionTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly PermissionService _svc;

    public PermissionTests()
    {
        _conn = new SqliteConnection("Data Source=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();

        // PermissionService 只需要 scope 工厂 + logger：复用测试里最小的 TestScopeFactory，
        // 不为一个服务搭整套 DI 容器，也让每个 scope 都指向同一个内存库。
        _svc = NewService();
    }

    /// <summary>新建一个服务实例：用来证明状态确实来自数据库，而不是上一个实例的内存缓存</summary>
    private PermissionService NewService() =>
        new(new TestScopeFactory(_db), NullLogger<PermissionService>.Instance);

    [Fact]
    public async Task Defaults_MemberCanViewInventory_ButCannotManage()
    {
        await _svc.ReloadAsync();

        Assert.True(_svc.Has("member", "material.inventory.view"));
        Assert.False(_svc.Has("member", "material.inventory.manage"));
    }

    [Fact]
    public async Task Defaults_StaffCanManageInventory()
    {
        await _svc.ReloadAsync();

        Assert.True(_svc.Has("部长", "material.inventory.manage"));
    }

    [Fact]
    public async Task Defaults_AdminOwnsEveryPermissionInCatalog()
    {
        await _svc.ReloadAsync();

        // 逐个断言而不是数量比较：新增权限点忘了给 admin 时，失败信息直接点名缺哪个
        foreach (var perm in PermissionCatalog.All)
        {
            Assert.True(_svc.Has("admin", perm.Key), $"admin 缺少权限点 {perm.Key}");
        }
    }

    [Fact]
    public async Task Has_UnknownOrNullRole_IsDenied()
    {
        await _svc.ReloadAsync();

        // 授权处理器在匿名请求上也走 Has(null, ...)，不能抛异常
        Assert.False(_svc.Has(null, "material.inventory.view"));
        Assert.False(_svc.Has("不存在的角色", "material.inventory.view"));
        Assert.False(_svc.Has("member", "权限点拼错了"));
    }

    [Fact]
    public async Task SaveOverride_RevokesForRole_AndSurvivesReload()
    {
        await _svc.ReloadAsync();
        await _svc.SaveAsync(new[] { ("member", "material.inventory.view", false) }, userId: 7);

        Assert.False(_svc.Has("member", "material.inventory.view"));

        // 换一个新实例从数据库重建矩阵：证明覆盖真的落库，而不是只改了内存
        var afterRestart = NewService();
        await afterRestart.ReloadAsync();
        Assert.False(afterRestart.Has("member", "material.inventory.view"));

        var row = await _db.RolePermissions.SingleAsync(r =>
            r.Role == "member" && r.Permission == "material.inventory.view");
        Assert.False(row.Allowed);           // 覆盖行必须能表达「收回」，只存授予是不够的
        Assert.Equal(7, row.UpdatedByUserId!.Value); // 审计字段要记下是谁改的
    }

    [Fact]
    public async Task SaveOverride_SameAsDefault_LeavesNoRow()
    {
        await _svc.ReloadAsync();

        // member 默认就没有 manage：写 manage=false 与默认一致 → 不该产生覆盖行
        await _svc.SaveAsync(new[] { ("member", "material.inventory.manage", false) }, userId: null);
        Assert.False(await _db.RolePermissions.AnyAsync());

        // 先制造一条覆盖，再改回默认值 → 行被删除（「恢复默认 = 删行」的语义）
        await _svc.SaveAsync(new[] { ("member", "material.inventory.view", false) }, userId: null);
        Assert.Equal(1, await _db.RolePermissions.CountAsync());

        await _svc.SaveAsync(new[] { ("member", "material.inventory.view", true) }, userId: null);
        Assert.False(await _db.RolePermissions.AnyAsync());
        Assert.True(_svc.Has("member", "material.inventory.view"));
    }

    [Fact]
    public async Task ResetRoleAsync_ClearsOverridesOfThatRoleOnly()
    {
        await _svc.ReloadAsync();
        await _svc.SaveAsync(new[]
        {
            ("member", "material.inventory.view", false),
            ("member", "content.knowledge.edit", true),
            ("部长", "material.inventory.view", false),
        }, userId: null);
        Assert.Equal(3, await _db.RolePermissions.CountAsync());
        Assert.False(_svc.Has("member", "material.inventory.view"));
        Assert.False(_svc.Has("部长", "material.inventory.view"));

        await _svc.ResetRoleAsync("member");

        // 部长的覆盖行必须留着：重置是按角色收窄的，不是清空整张表
        Assert.Equal(1, await _db.RolePermissions.CountAsync());
        Assert.True(_svc.Has("member", "material.inventory.view"));
        Assert.False(_svc.Has("member", "content.knowledge.edit"));
        Assert.False(_svc.Has("部长", "material.inventory.view"));
    }

    [Fact]
    public async Task Overrides_AreIsolatedPerRole()
    {
        await _svc.ReloadAsync();

        // 给部长加一个它默认没有的权限，member 不该跟着拿到
        await _svc.SaveAsync(new[] { ("部长", "admin.settings.manage", true) }, userId: null);
        Assert.True(_svc.Has("部长", "admin.settings.manage"));
        Assert.False(_svc.Has("member", "admin.settings.manage"));

        // 反向：收回部长的默认权限，也不影响 member 的默认
        await _svc.SaveAsync(new[] { ("部长", "material.inventory.view", false) }, userId: null);
        Assert.False(_svc.Has("部长", "material.inventory.view"));
        Assert.True(_svc.Has("member", "material.inventory.view"));

        // admin 不受任何非 admin 覆盖影响
        Assert.True(_svc.Has("admin", "admin.settings.manage"));
        Assert.True(_svc.Has("admin", "material.inventory.view"));
    }

    public void Dispose()
    {
        _db.Dispose();
        _conn.Dispose();
    }
}
