using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// Centralized system settings store with in-memory cache.
/// All hardcoded config values in services should migrate here.
/// </summary>
public class SettingsService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ConcurrentDictionary<string, string> _cache = new();

    public SettingsService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    /// <summary>Get a setting value, with fallback default.</summary>
    public async Task<string> Get(string key, string defaultValue = "")
    {
        if (_cache.TryGetValue(key, out var cached))
            return cached;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var setting = await db.SystemSettings.FindAsync(key);
        if (setting is not null)
        {
            _cache[key] = setting.Value;
            return setting.Value;
        }
        return defaultValue;
    }

    /// <summary>Get typed value.</summary>
    public async Task<int> GetInt(string key, int defaultValue = 0)
        => int.TryParse(await Get(key, defaultValue.ToString()), out var v) ? v : defaultValue;

    public async Task<double> GetDouble(string key, double defaultValue = 0)
        => double.TryParse(await Get(key, defaultValue.ToString()), out var v) ? v : defaultValue;

    /// <summary>Set a setting value (persists to DB and cache).</summary>
    public async Task Set(string key, string value, string category = "", string description = "")
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var setting = await db.SystemSettings.FindAsync(key);
        if (setting is null)
        {
            setting = new SystemSetting { Key = key, Category = category, Description = description };
            db.SystemSettings.Add(setting);
        }
        setting.Value = value;
        setting.UpdatedAt = DateTime.UtcNow;
        if (!string.IsNullOrEmpty(category)) setting.Category = category;
        await db.SaveChangesAsync();
        _cache[key] = value;
    }

    /// <summary>Get all settings grouped by category.</summary>
    public async Task<Dictionary<string, List<SystemSetting>>> GetAllGrouped()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var all = await db.SystemSettings.OrderBy(s => s.Key).ToListAsync();
        // Update cache
        foreach (var s in all) _cache[s.Key] = s.Value;
        return all.GroupBy(s => s.Category)
                  .ToDictionary(g => g.Key, g => g.ToList());
    }

    /// <summary>Batch update settings from frontend form.</summary>
    public async Task BatchUpdate(Dictionary<string, string> updates)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        foreach (var (key, value) in updates)
        {
            var setting = await db.SystemSettings.FindAsync(key);
            if (setting is not null)
            {
                setting.Value = value;
                setting.UpdatedAt = DateTime.UtcNow;
                _cache[key] = value;
            }
        }
        await db.SaveChangesAsync();
    }

    /// <summary>Seed default settings if table is empty.</summary>
    public async Task SeedDefaults()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (await db.SystemSettings.AnyAsync()) return;

        var defaults = new List<SystemSetting>
        {
            new() { Key = "Auth:JwtExpireDays", Value = "7", Category = "认证安全", Description = "JWT Token 过期天数" },
            new() { Key = "Auth:MaxLoginAttempts", Value = "5", Category = "认证安全", Description = "登录失败最大次数（超限后锁定）" },
            new() { Key = "Auth:LockoutMinutes", Value = "15", Category = "认证安全", Description = "登录锁定分钟数" },
            new() { Key = "Auth:PasswordMinLength", Value = "6", Category = "认证安全", Description = "密码最小长度" },
            new() { Key = "AI:DeepSeekKey", Value = "", Category = "AI 服务", Description = "DeepSeek API Key" },
            new() { Key = "AI:DeepSeekBaseUrl", Value = "https://api.deepseek.com", Category = "AI 服务", Description = "DeepSeek API 地址" },
            new() { Key = "AI:ModelName", Value = "deepseek-chat", Category = "AI 服务", Description = "AI 模型名称" },
            new() { Key = "AI:MaxIterations", Value = "25", Category = "AI 服务", Description = "AI Agent 最大迭代次数" },
            new() { Key = "AI:Temperature", Value = "0.7", Category = "AI 服务", Description = "AI 温度参数 (0-1)" },
            new() { Key = "Baidu:AppKey", Value = "", Category = "百度网盘", Description = "百度开放平台 AppKey" },
            new() { Key = "Baidu:SecretKey", Value = "", Category = "百度网盘", Description = "百度开放平台 SecretKey" },
            new() { Key = "Baidu:SignKey", Value = "", Category = "百度网盘", Description = "百度开放平台 SignKey" },
            new() { Key = "Wiki:PollingIntervalSec", Value = "30", Category = "系统参数", Description = "Wiki 任务轮询间隔（秒）" },
            new() { Key = "Wiki:MaxIterations", Value = "30", Category = "系统参数", Description = "Wiki 生成最大迭代次数" },
            new() { Key = "System:LogRetentionDays", Value = "90", Category = "系统参数", Description = "日志保留天数" },
        };
        db.SystemSettings.AddRange(defaults);
        await db.SaveChangesAsync();
    }

    /// <summary>Clear cache (call after external DB changes).</summary>
    public void ClearCache() => _cache.Clear();
}
