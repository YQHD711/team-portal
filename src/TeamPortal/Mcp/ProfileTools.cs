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
    public async Task<object> TrainingAdd(string courseName, double? score = null, string? examiner = null, string? notes = null) => await _profile.AddTrainingRecord(GetUserId(), courseName, score, DateTime.UtcNow, examiner, notes);
    [McpServerTool(Name = "profile_competition_list")]
    public async Task<object> CompetitionList() => await _profile.GetCompetitionRecords(GetUserId());
    [McpServerTool(Name = "profile_competition_add")]
    public async Task<object> CompetitionAdd(string competitionName, string? eventName = null, string? ranking = null, string? notes = null) => await _profile.AddCompetitionRecord(GetUserId(), competitionName, DateTime.UtcNow, eventName, ranking, null, notes);
}
