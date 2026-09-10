using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

/// <summary>
/// 系统运维工具,全部限管理员。
/// 对应 HTTP 侧 /api/admin/settings、/api/admin/backup、/api/admin/logs、
/// /api/admin/maintenance 都是 AdminOnly;而且这里 system_settings_get 能读到
/// AI:DeepSeekKey 等明文密钥、system_settings_set 能改 AI:DeepSeekBaseUrl
/// 把 Bearer 密钥外带到攻击者地址,因此不能只靠"已登录"。
/// </summary>
[McpServerToolType]
public class SystemTools
{
    private readonly BackupService _backup;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly MaintenanceService _maintenance;
    private readonly IHttpContextAccessor _http;

    public SystemTools(BackupService backup, LogService log, SettingsService settings,
        MaintenanceService maintenance, IHttpContextAccessor http)
    { _backup = backup; _log = log; _settings = settings; _maintenance = maintenance; _http = http; }

    [McpServerTool(Name = "system_health")]
    public async Task<object> Health() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _log.GetHealth();
    [McpServerTool(Name = "system_backup_create")]
    public async Task<string> BackupCreate() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _backup.CreateBackup();
    [McpServerTool(Name = "system_backup_list")]
    public object BackupList() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : _backup.ListBackups();
    [McpServerTool(Name = "system_backup_stats")]
    public object BackupStats() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : _backup.GetStats();
    [McpServerTool(Name = "system_backup_restore")]
    public async Task<object> BackupRestore(string fileName) => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _backup.Restore(fileName);
    [McpServerTool(Name = "system_backup_delete")]
    public object BackupDelete(string fileName) => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : _backup.DeleteBackup(fileName);
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
        return "ok";
    }
    [McpServerTool(Name = "system_settings_list")]
    public async Task<object> SettingsList() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _settings.GetAllGrouped();
    [McpServerTool(Name = "system_maintenance_history")]
    public async Task<object> MaintenanceHistory() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _maintenance.GetHistory();
    [McpServerTool(Name = "system_maintenance_apply")]
    public async Task<object> MaintenanceApply() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _maintenance.ApplyChanges();
    [McpServerTool(Name = "system_maintenance_rollback")]
    public async Task<object> MaintenanceRollback() => !McpAuth.IsAdmin(_http) ? McpAuth.Forbidden : await _maintenance.Rollback();
}
