using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 系统运维工具,全部限管理员。
/// 对应 HTTP 侧 /api/admin/settings、/api/admin/backup、/api/admin/logs
/// 都是 AdminOnly;而且这里 system_settings_get 能读到
/// AI:DeepSeekKey 等明文密钥、system_settings_set 能改 AI:DeepSeekBaseUrl
/// 把 Bearer 密钥外带到攻击者地址,因此不能只靠"已登录"。
/// 恢复备份与 HTTP 一致要求显式 confirm=true(HTTP BackupEndpoints.cs:55)。
/// （原 system_maintenance_* 三个工具随「代码提案 + 编译重启」功能一并下线。）
/// </summary>
[McpServerToolType]
public class SystemTools
{
    private readonly BackupService _backup;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly IHttpContextAccessor _http;

    public SystemTools(BackupService backup, LogService log, SettingsService settings, IHttpContextAccessor http)
    { _backup = backup; _log = log; _settings = settings; _http = http; }

    private void Audit(string action, string? targetType, string? targetId, object data)
        => _log.Audit(action, McpAuth.UserName(_http), targetType: targetType, targetId: targetId,
            data: data, ipAddress: McpAuth.ClientIp(_http), userId: McpAuth.UserId(_http));

    [McpServerTool(Name = "system_health")]
    public async Task<object> Health() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _log.GetHealth();

    [McpServerTool(Name = "system_backup_create")]
    public async Task<string> BackupCreate()
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        try
        {
            var path = await _backup.CreateBackup();
            Audit("backup", "backup", Path.GetFileName(path), new { action = "create", via = "mcp", success = true });
            return path;
        }
        catch (Exception e)
        {
            Audit("backup", "backup", null, new { action = "create", via = "mcp", success = false, error = e.Message });
            throw;
        }
    }

    [McpServerTool(Name = "system_backup_list")]
    public object BackupList() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : _backup.ListBackups();

    [McpServerTool(Name = "system_backup_stats")]
    public object BackupStats() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : _backup.GetStats();

    [McpServerTool(Name = "system_backup_restore")]
    public async Task<object> BackupRestore(string fileName, bool confirm)
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        // 与 HTTP POST /api/admin/backup/restore 对齐:必须显式 confirm=true,否则拒绝
        if (!confirm) return "拒绝：恢复会覆盖当前数据库，请在调用时显式传 confirm=true 确认恢复操作";
        var ok = await _backup.Restore(fileName);
        Audit("restore", "backup", fileName, new { action = "restore", via = "mcp", success = ok });
        return ok;
    }

    [McpServerTool(Name = "system_backup_delete")]
    public object BackupDelete(string fileName)
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        var ok = _backup.DeleteBackup(fileName);
        Audit("delete", "backup", fileName, new { action = "delete", via = "mcp", success = ok });
        return ok;
    }

    [McpServerTool(Name = "system_logs_query")]
    public async Task<object> LogsQuery(string? level = null, string? category = null, int page = 1, int pageSize = 50, string? keyword = null)
        => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _log.GetLogs(level, category, page, pageSize, null, null, keyword);

    [McpServerTool(Name = "system_logs_stats")]
    public async Task<object> LogsStats() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _log.GetStats();

    [McpServerTool(Name = "system_logs_export")]
    public async Task<string> LogsExport(string? level = null) => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _log.ExportCsv(level);

    [McpServerTool(Name = "system_settings_get")]
    public async Task<string> SettingsGet(string key, string defaultValue = "")
        => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _settings.Get(key, defaultValue);

    [McpServerTool(Name = "system_settings_set")]
    public async Task<string> SettingsSet(string key, string value, string category = "", string description = "")
    {
        if (!McpAuth.IsAdmin(_http)) return McpAuth.Forbidden;
        await _settings.Set(key, value, category, description);
        // 不记录 value:可能是 AI:DeepSeekKey 等密钥,审计只留 key/分类
        Audit("update", "settings", key, new { action = "settings.set", via = "mcp", category });
        return "ok";
    }

    [McpServerTool(Name = "system_settings_list")]
    public async Task<object> SettingsList() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _settings.GetAllGrouped();
}
