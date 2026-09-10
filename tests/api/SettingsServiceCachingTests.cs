using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>SettingsService 缓存 —— 覆盖 P0:未入库的键每次 Get 都回查 DB(每次 Audit 打一次库)。</summary>
public class SettingsServiceCachingTests
{
    private static AppDbContext CreateContext()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        context.Database.EnsureCreated();
        return context;
    }

    [Fact]
    public async Task Get_MissingKey_CachesFallback_NoRepeatDbHit()
    {
        var factory = new CountingScopeFactory(CreateContext());
        var svc = new SettingsService(factory);

        Assert.Equal("fallback", await svc.Get("Nope:Key", "fallback"));
        Assert.Equal(1, factory.ScopeCount);

        Assert.Equal("fallback", await svc.Get("Nope:Key", "fallback"));
        Assert.Equal(1, factory.ScopeCount); // 负结果已缓存,不再查库
    }

    [Fact]
    public async Task Get_ExistingKey_CachedAfterFirstRead()
    {
        var db = CreateContext();
        db.SystemSettings.Add(new SystemSetting { Key = "Brand:TeamName", Value = "测试队" });
        await db.SaveChangesAsync();
        var factory = new CountingScopeFactory(db);
        var svc = new SettingsService(factory);

        Assert.Equal("测试队", await svc.Get("Brand:TeamName"));
        Assert.Equal("测试队", await svc.Get("Brand:TeamName"));
        Assert.Equal(1, factory.ScopeCount);
    }

    [Fact]
    public async Task Set_UpdatesCache_WithoutDbRead()
    {
        var factory = new CountingScopeFactory(CreateContext());
        var svc = new SettingsService(factory);

        await svc.Set("System:AuditDataMaxLen", "512");
        var afterSet = factory.ScopeCount;

        Assert.True(svc.TryGetCachedInt("System:AuditDataMaxLen", out var v));
        Assert.Equal(512, v);
        Assert.Equal(afterSet, factory.ScopeCount);
    }

    [Fact]
    public void TryGetCachedInt_ColdCache_ReturnsFalse()
    {
        var svc = new SettingsService(new CountingScopeFactory(CreateContext()));

        Assert.False(svc.TryGetCachedInt("System:AuditDataMaxLen", out _));
    }

    [Fact]
    public async Task SeedDefaults_SeedsKeysReadByCode()
    {
        var svc = new SettingsService(new TestScopeFactory(CreateContext()));

        await svc.SeedDefaults();

        // 这三个键曾被代码读取却从未注册:设置页改不了,且每次读取都回查 DB
        Assert.True(svc.TryGetCachedInt("System:AuditDataMaxLen", out var maxLen));
        Assert.Equal(2000, maxLen);
        Assert.True(svc.TryGetCachedInt("System:OperationLogRetentionDays", out var days));
        Assert.Equal(180, days);
        Assert.Equal("false", await svc.Get("Auth:OpenRegistration"));
    }
}

/// <summary>统计 CreateScope 次数,用于断言热路径不再查库。</summary>
internal sealed class CountingScopeFactory : IServiceScopeFactory
{
    private readonly IServiceScopeFactory _inner;
    private int _count;

    public CountingScopeFactory(AppDbContext db) => _inner = new TestScopeFactory(db);

    public int ScopeCount => Volatile.Read(ref _count);

    public IServiceScope CreateScope()
    {
        Interlocked.Increment(ref _count);
        return _inner.CreateScope();
    }
}
