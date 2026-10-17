using System.Security.Claims;
using ModelContextProtocol.Server;
using TeamPortal.Services;

namespace TeamPortal.Mcp;

[McpServerToolType]
public class ProfileTools
{
    private readonly ProfileService _profile;
    private readonly IHttpContextAccessor _http;
    public ProfileTools(ProfileService profile, IHttpContextAccessor http) { _profile = profile; _http = http; }
    private int GetUserId() => int.TryParse(_http.HttpContext?.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : 0;
    [McpServerTool(Name = "profile_get")]
    public async Task<object?> Get() => await _profile.GetFullProfile(GetUserId());
    [McpServerTool(Name = "profile_update")]
    public async Task<bool> Update(string? level = null, double? flightHours = null, string? bio = null, string? emergencyContact = null, string? emergencyPhone = null, string? flightTypes = null, string? skills = null) => await _profile.UpdateProfile(GetUserId(), level, flightHours, null, bio, emergencyContact, emergencyPhone, flightTypes, skills);
    [McpServerTool(Name = "profile_training_list")]
    public async Task<object> TrainingList() => await _profile.GetTrainingRecords(GetUserId());
    [McpServerTool(Name = "profile_training_add")]
    public async Task<object> TrainingAdd(string courseName, double? score = null, string? examiner = null, string? notes = null)
        // 与 HTTP 对齐：训练记录由 /api/admin/profiles 组写入（仅 staff/管理员，含可管理范围校验）。
        // 之前 MCP 不判 → 成员可给自己写"训练/考核成绩"（审计 #9 的"自助写组织评定"）。
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _profile.AddTrainingRecord(GetUserId(), courseName, score, DateTime.UtcNow, examiner, notes);
    [McpServerTool(Name = "profile_competition_list")]
    public async Task<object> CompetitionList() => await _profile.GetCompetitionRecords(GetUserId());
    [McpServerTool(Name = "profile_competition_add")]
    public async Task<object> CompetitionAdd(string competitionName, string? eventName = null, string? ranking = null, string? notes = null)
        // 同上：比赛记录也是 staff 才能写
        => !McpAuth.IsStaff(_http) ? McpAuth.Forbidden : await _profile.AddCompetitionRecord(GetUserId(), competitionName, DateTime.UtcNow, eventName, ranking, null, notes);
}
