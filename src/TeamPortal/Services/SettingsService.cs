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

    /// <summary>Ensure all default settings exist. Missing keys are added, existing ones left untouched.</summary>
    public async Task SeedDefaults()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var defaults = new List<SystemSetting>
        {
            new() { Key = "Auth:JwtExpireDays", Value = "7", Category = "认证安全", Description = "JWT Token 过期天数" },
            new() { Key = "Auth:MaxLoginAttempts", Value = "5", Category = "认证安全", Description = "登录失败最大次数（超限后锁定）" },
            new() { Key = "Auth:LockoutMinutes", Value = "15", Category = "认证安全", Description = "登录锁定分钟数" },
            new() { Key = "Auth:PasswordMinLength", Value = "6", Category = "认证安全", Description = "密码最小长度" },
            new() { Key = "AI:DeepSeekKey", Value = "", Category = "AI 服务", Description = "DeepSeek API Key" },
            new() { Key = "AI:DeepSeekBaseUrl", Value = "https://api.deepseek.com", Category = "AI 服务", Description = "DeepSeek API 地址" },
            new() { Key = "AI:ModelName", Value = "deepseek-v4-pro", Category = "AI 服务", Description = "AI 模型名称（deepseek-v4-pro / deepseek-v4-flash）" },
            new() { Key = "AI:MaxIterations", Value = "25", Category = "AI 服务", Description = "AI Agent 最大迭代次数" },
            new() { Key = "AI:Temperature", Value = "0.7", Category = "AI 服务", Description = "AI 温度参数 (0-1)" },
            new() { Key = "AI:AgentTimeoutMinutes", Value = "20", Category = "AI 服务", Description = "AI Agent 单次任务总超时（分钟）" },
            new() { Key = "AI:MaxTokens", Value = "8192", Category = "AI 服务", Description = "AI 单次 API 调用最大输出 token 数" },
            new() { Key = "AI:RequestTimeoutSeconds", Value = "300", Category = "AI 服务", Description = "AI 单次 HTTP 请求超时（秒）" },
            new() { Key = "AI:EnableThinking", Value = "false", Category = "AI 服务", Description = "启用 V4 thinking 深度思考模式（开启后耗时显著增加）" },
            new() { Key = "AI:ReasoningEffort", Value = "medium", Category = "AI 服务", Description = "思考深度：low / medium / high / max" },
            new() { Key = "Baidu:AppKey", Value = "", Category = "百度网盘", Description = "百度开放平台 AppKey" },
            new() { Key = "Baidu:SecretKey", Value = "", Category = "百度网盘", Description = "百度开放平台 SecretKey" },
            new() { Key = "Baidu:SignKey", Value = "", Category = "百度网盘", Description = "百度开放平台 SignKey" },
            new() { Key = "Wiki:PollingIntervalSec", Value = "30", Category = "系统参数", Description = "Wiki 任务轮询间隔（秒）" },
            new() { Key = "Wiki:MaxIterations", Value = "30", Category = "系统参数", Description = "Wiki 生成最大迭代次数" },
            new() { Key = "System:LogRetentionDays", Value = "90", Category = "系统参数", Description = "日志保留天数" },
            new() { Key = "Brand:TeamName", Value = "雏鹰之翼", Category = "品牌", Description = "团队名称（登录页/侧边栏/仪表盘）" },
            new() { Key = "Brand:TeamSubtitle", Value = "航模队", Category = "品牌", Description = "团队副标题（显示在队名旁）" },
            new() { Key = "Brand:SystemTitle", Value = "", Category = "品牌", Description = "系统标题（留空自动用“队名 · 副标题管理系统”）" },
            new() { Key = "Brand:Description", Value = "", Category = "品牌", Description = "系统描述（留空自动生成）" },
            new() { Key = "Brand:LogoUrl", Value = "", Category = "品牌", Description = "Logo 图片 URL（留空使用默认 /logo.png）" },
            new() { Key = "Brand:PrimaryColor", Value = "", Category = "品牌", Description = "品牌主题色（如 #5e6ad2，留空随主题；设置后覆盖主题主色）" },
            new() { Key = "Brand:Theme", Value = "indigo", Category = "品牌", Description = "配色主题：indigo(深空靛蓝)/sky(深空天青)/light(日光蓝)/warm(暖白)" },
        };

        var existingKeys = await db.SystemSettings.Select(s => s.Key).ToListAsync();
        var toAdd = defaults.Where(d => !existingKeys.Contains(d.Key)).ToList();
        if (toAdd.Count > 0)
        {
            db.SystemSettings.AddRange(toAdd);
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Get public brand config for frontend (/api/public/brand).
    /// 未设置的项自动回退默认值；SystemTitle/Description 留空时由队名 + 副标题拼接。
    /// </summary>
    public async Task<BrandConfig> GetBrandConfig()
    {
        var teamName = await Get("Brand:TeamName", "雏鹰之翼");
        var teamSubtitle = await Get("Brand:TeamSubtitle", "航模队");
        var systemTitle = await Get("Brand:SystemTitle");
        var description = await Get("Brand:Description");
        var logoUrl = await Get("Brand:LogoUrl");
        var primaryColor = await Get("Brand:PrimaryColor");
        var theme = await Get("Brand:Theme", "indigo");
        // 校验主题名，非法值回退默认
        if (theme is not ("indigo" or "sky" or "light" or "warm"))
            theme = "indigo";

        if (string.IsNullOrWhiteSpace(systemTitle))
            systemTitle = $"{teamName} · {teamSubtitle}管理系统";
        if (string.IsNullOrWhiteSpace(description))
            description = $"{teamName}{teamSubtitle} — 知识库、零件库存、飞行日志管理与AI助手";

        return new BrandConfig(
            teamName, teamSubtitle, systemTitle, description,
            string.IsNullOrWhiteSpace(logoUrl) ? null : logoUrl,
            string.IsNullOrWhiteSpace(primaryColor) ? null : primaryColor,
            theme);
    }

    /// <summary>Clear cache (call after external DB changes).</summary>
    public void ClearCache() => _cache.Clear();
}

/// <summary>公开的品牌配置（GET /api/public/brand 返回结构）。</summary>
public record BrandConfig(
    string TeamName,
    string TeamSubtitle,
    string SystemTitle,
    string Description,
    string? LogoUrl,
    string? PrimaryColor,
    string Theme);
