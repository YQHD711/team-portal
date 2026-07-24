using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class SystemTools
{
    private readonly BackupService _backup;
    private readonly LogService _log;
    private readonly SettingsService _settings;
    private readonly MaintenanceService _maintenance;
    public SystemTools(BackupService backup, LogService log, SettingsService settings, MaintenanceService maintenance) { _backup = backup; _log = log; _settings = settings; _maintenance = maintenance; }

    [McpServerTool(Name = "system_health")]
    public async Task<object> Health() => await _log.GetHealth();
    [McpServerTool(Name = "system_backup_create")]
    public async Task<string> BackupCreate() => await _backup.CreateBackup();
    [McpServerTool(Name = "system_backup_list")]
    public object BackupList() => _backup.ListBackups();
    [McpServerTool(Name = "system_backup_stats")]
    public object BackupStats() => _backup.GetStats();
    [McpServerTool(Name = "system_backup_restore")]
    public async Task<bool> BackupRestore(string fileName) => await _backup.Restore(fileName);
    [McpServerTool(Name = "system_backup_delete")]
    public bool BackupDelete(string fileName) => _backup.DeleteBackup(fileName);
    [McpServerTool(Name = "system_logs_query")]
    public async Task<object> LogsQuery(string? level = null, string? category = null, int page = 1, int pageSize = 50, string? keyword = null) => await _log.GetLogs(level, category, page, pageSize, null, null, keyword);
    [McpServerTool(Name = "system_logs_stats")]
    public async Task<object> LogsStats() => await _log.GetStats();
    [McpServerTool(Name = "system_logs_export")]
    public async Task<string> LogsExport(string? level = null) => await _log.ExportCsv(level);
    [McpServerTool(Name = "system_settings_get")]
    public async Task<string> SettingsGet(string key, string defaultValue = "") => await _settings.Get(key, defaultValue);
    [McpServerTool(Name = "system_settings_set")]
    public async Task SettingsSet(string key, string value, string category = "", string description = "") => await _settings.Set(key, value, category, description);
    [McpServerTool(Name = "system_settings_list")]
    public async Task<object> SettingsList() => await _settings.GetAllGrouped();
    [McpServerTool(Name = "system_maintenance_history")]
    public async Task<object> MaintenanceHistory() => await _maintenance.GetHistory();
    [McpServerTool(Name = "system_maintenance_apply")]
    public async Task<object> MaintenanceApply() => await _maintenance.ApplyChanges();
    [McpServerTool(Name = "system_maintenance_rollback")]
    public async Task<object> MaintenanceRollback() => await _maintenance.Rollback();
}
