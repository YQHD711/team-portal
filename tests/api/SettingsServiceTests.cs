using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

public class SettingsServiceTests
{
    private AppDbContext CreateContext()
    {
        // SQLite 内存库（与 MaterialServiceTests 一致；InMemory 包已从测试项目移除）
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new AppDbContext(opts);
        context.Database.EnsureCreated();
        return context;
    }

    private SettingsService CreateService(AppDbContext db)
        => new(new TestScopeFactory(db));

    [Fact]
    public async Task GetBrandConfig_NoSettings_ReturnsDefaults()
    {
        var db = CreateContext();
        var svc = CreateService(db);

        var brand = await svc.GetBrandConfig();

        Assert.Equal("雏鹰之翼", brand.TeamName);
        Assert.Equal("航模队", brand.TeamSubtitle);
        Assert.Equal("雏鹰之翼 · 航模队管理系统", brand.SystemTitle);
        Assert.Equal("雏鹰之翼航模队 — 知识库、零件库存、飞行日志管理与AI助手", brand.Description);
        Assert.Null(brand.LogoUrl);
        Assert.Null(brand.PrimaryColor);
    }

    [Fact]
    public async Task GetBrandConfig_CustomTeamName_ComposesTitleAndDescription()
    {
        var db = CreateContext();
        db.SystemSettings.Add(new SystemSetting { Key = "Brand:TeamName", Value = "测试队" });
        await db.SaveChangesAsync();
        var svc = CreateService(db);

        var brand = await svc.GetBrandConfig();

        Assert.Equal("测试队", brand.TeamName);
        // 未显式设置 SystemTitle/Description 时自动拼接
        Assert.Equal("测试队 · 航模队管理系统", brand.SystemTitle);
        Assert.Equal("测试队航模队 — 知识库、零件库存、飞行日志管理与AI助手", brand.Description);
    }

    [Fact]
    public async Task GetBrandConfig_ExplicitValues_ReturnedAsIs()
    {
        var db = CreateContext();
        db.SystemSettings.AddRange(
            new SystemSetting { Key = "Brand:SystemTitle", Value = "自定义标题" },
            new SystemSetting { Key = "Brand:LogoUrl", Value = "https://example.com/logo.png" },
            new SystemSetting { Key = "Brand:PrimaryColor", Value = "#ff0000" });
        await db.SaveChangesAsync();
        var svc = CreateService(db);

        var brand = await svc.GetBrandConfig();

        Assert.Equal("自定义标题", brand.SystemTitle);
        Assert.Equal("https://example.com/logo.png", brand.LogoUrl);
        Assert.Equal("#ff0000", brand.PrimaryColor);
    }

    [Fact]
    public async Task GetBrandConfig_ThemeDefaultsToIndigo()
    {
        var db = CreateContext();
        var svc = CreateService(db);

        var brand = await svc.GetBrandConfig();

        // 缺省时主题为 indigo（保证 BrandConfig.Theme 非空）
        Assert.Equal("indigo", brand.Theme);
    }

    [Fact]
    public async Task GetBrandConfig_InvalidTheme_FallsBackToIndigo()
    {
        var db = CreateContext();
        db.SystemSettings.Add(new SystemSetting { Key = "Brand:Theme", Value = "rainbow" });
        await db.SaveChangesAsync();
        var svc = CreateService(db);

        var brand = await svc.GetBrandConfig();

        Assert.Equal("indigo", brand.Theme);
    }

    [Fact]
    public async Task GetBrandConfig_ValidTheme_Preserved()
    {
        var db = CreateContext();
        db.SystemSettings.Add(new SystemSetting { Key = "Brand:Theme", Value = "warm" });
        await db.SaveChangesAsync();
        var svc = CreateService(db);

        var brand = await svc.GetBrandConfig();

        Assert.Equal("warm", brand.Theme);
    }
}
