using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class ProfileService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    public ProfileService(AppDbContext db, LogService log) { _db = db; _log = log; }

    // ── Profile ──

    public async Task<PilotProfile?> GetProfile(int userId)
    {
        return await _db.PilotProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
    }

    public async Task<PilotProfile> GetOrCreateProfile(int userId)
    {
        var profile = await _db.PilotProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile is null)
        {
            profile = new PilotProfile { UserId = userId };
            _db.PilotProfiles.Add(profile);
            await _db.SaveChangesAsync();
        }
        return profile;
    }

    public async Task<bool> UpdateProfile(int userId, string? level, double? flightHours, DateTime? firstFlight,
        string? bio, string? emergencyContact, string? emergencyPhone, string? flightTypes, string? skills)
    {
        var profile = await _db.PilotProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile is null) return false;

        var changes = new List<string>();
        if (level is not null && profile.Level != level) { changes.Add($"level:{profile.Level}→{level}"); profile.Level = level; }
        if (flightHours.HasValue && Math.Abs(profile.TotalFlightHours - flightHours.Value) > 0.01) { changes.Add($"hours:{profile.TotalFlightHours}→{flightHours.Value}"); profile.TotalFlightHours = flightHours.Value; }
        if (firstFlight.HasValue && profile.FirstFlightDate != firstFlight) { changes.Add("firstFlight"); profile.FirstFlightDate = firstFlight; }
        if (bio is not null && profile.Bio != bio) { changes.Add("bio"); profile.Bio = bio; }
        if (emergencyContact is not null && profile.EmergencyContact != emergencyContact) { changes.Add("emergency"); profile.EmergencyContact = emergencyContact; }
        if (emergencyPhone is not null && profile.EmergencyPhone != emergencyPhone) { changes.Add("phone"); profile.EmergencyPhone = emergencyPhone; }
        if (flightTypes is not null && profile.FlightTypes != flightTypes) { changes.Add("flightTypes"); profile.FlightTypes = flightTypes; }
        if (skills is not null && profile.Skills != skills) { changes.Add($"skills"); profile.Skills = skills; }
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        if (changes.Count > 0)
            _log.Info("profile", $"Profile updated: userId={userId}", $"{{\"changes\":\"{string.Join(",", changes)}\"}}");
        return true;
    }

    // ── Training ──

    public async Task<List<TrainingRecord>> GetTrainingRecords(int userId)
    {
        return await _db.TrainingRecords
            .Where(t => t.UserId == userId)
            .OrderByDescending(t => t.ExamDate)
            .ToListAsync();
    }

    public async Task<TrainingRecord> AddTrainingRecord(int userId, string courseName, double? score,
        DateTime examDate, string? examiner, string? notes)
    {
        var record = new TrainingRecord
        {
            UserId = userId, CourseName = courseName, Score = score,
            ExamDate = examDate, Examiner = examiner, Notes = notes
        };
        _db.TrainingRecords.Add(record);
        await _db.SaveChangesAsync();
        _log.Info("profile", $"Training record added for user {userId}: {courseName}");
        return record;
    }

    public async Task<bool> UpdateTrainingRecord(int id, string? courseName, double? score,
        DateTime? examDate, string? examiner, string? notes)
    {
        var record = await _db.TrainingRecords.FindAsync(id);
        if (record is null) return false;
        if (courseName is not null) record.CourseName = courseName;
        if (score.HasValue) record.Score = score.Value;
        if (examDate.HasValue) record.ExamDate = examDate.Value;
        if (examiner is not null) record.Examiner = examiner;
        if (notes is not null) record.Notes = notes;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteTrainingRecord(int id)
    {
        var record = await _db.TrainingRecords.FindAsync(id);
        if (record is null) return false;
        _db.TrainingRecords.Remove(record);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>批量给多人加同一次培训记录(同一课程同一次上课)。返回实际创建的记录数。
    /// 自动跳过不存在的 userId(FK 失败),避免整批回滚。</summary>
    public async Task<int> BatchAddTrainingForUsers(IEnumerable<int> userIds, string courseName, DateTime examDate,
        double? score, string? examiner, string? notes)
    {
        if (string.IsNullOrWhiteSpace(courseName)) throw new ArgumentException("课程名称不能为空");
        var distinctIds = userIds.Distinct().ToList();
        if (distinctIds.Count == 0) return 0;
        var existingIds = await _db.Users.Where(u => distinctIds.Contains(u.Id)).Select(u => u.Id).ToListAsync();
        var records = existingIds.Select(uid => new TrainingRecord
        {
            UserId = uid, CourseName = courseName, ExamDate = examDate,
            Score = score, Examiner = examiner, Notes = notes
        }).ToList();
        if (records.Count == 0) return 0;
        _db.TrainingRecords.AddRange(records);
        await _db.SaveChangesAsync();
        _log.Info("profile", $"Batch training: course='{courseName}', {records.Count}/{distinctIds.Count} users (skipped {distinctIds.Count - records.Count} missing), date={examDate:yyyy-MM-dd}");
        return records.Count;
    }

    // ── Competition ──

    public async Task<List<CompetitionRecord>> GetCompetitionRecords(int userId)
    {
        return await _db.CompetitionRecords
            .Where(c => c.UserId == userId)
            .OrderByDescending(c => c.Date)
            .ToListAsync();
    }

    public async Task<CompetitionRecord> AddCompetitionRecord(int userId, string competitionName,
        DateTime date, string? evt, string? ranking, string? certificate, string? notes)
    {
        var record = new CompetitionRecord
        {
            UserId = userId, CompetitionName = competitionName, Date = date,
            Event = evt, Ranking = ranking, Certificate = certificate, Notes = notes
        };
        _db.CompetitionRecords.Add(record);
        await _db.SaveChangesAsync();
        _log.Info("profile", $"Competition record added for user {userId}: {competitionName}");
        return record;
    }

    public async Task<bool> UpdateCompetitionRecord(int id, string? competitionName,
        DateTime? date, string? evt, string? ranking, string? certificate, string? notes)
    {
        var record = await _db.CompetitionRecords.FindAsync(id);
        if (record is null) return false;
        if (competitionName is not null) record.CompetitionName = competitionName;
        if (date.HasValue) record.Date = date.Value;
        if (evt is not null) record.Event = evt;
        if (ranking is not null) record.Ranking = ranking;
        if (certificate is not null) record.Certificate = certificate;
        if (notes is not null) record.Notes = notes;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteCompetitionRecord(int id)
    {
        var record = await _db.CompetitionRecords.FindAsync(id);
        if (record is null) return false;
        _db.CompetitionRecords.Remove(record);
        await _db.SaveChangesAsync();
        return true;
    }

    // ── Admin: list all profiles ──

    public async Task<List<object>> ListAllProfiles()
    {
        return await _db.PilotProfiles
            .Include(p => p.User)
            .ThenInclude(u => u!.Department)
            .OrderBy(p => p.User!.Username)
            .Select(p => new
            {
                p.Id, p.UserId, Username = p.User!.Username,
                Department = p.User.Department != null ? p.User.Department.Name : null,
                p.Level, p.TotalFlightHours, p.FirstFlightDate, p.Skills, p.UpdatedAt
            })
            .ToListAsync<object>();
    }

    public async Task<object?> GetFullProfile(int userId)
    {
        // 用户不存在 → null；档案不存在 → 懒创建（管理员查看无档案队员不再 404）
        if (!await _db.Users.AnyAsync(u => u.Id == userId)) return null;
        await GetOrCreateProfile(userId);

        var profile = await _db.PilotProfiles
            .Include(p => p.User)
            .ThenInclude(u => u!.Department)
            .FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile is null) return null;

        var training = await GetTrainingRecords(userId);
        var competitions = await GetCompetitionRecords(userId);

        return new
        {
            profile.Id, profile.UserId, Username = profile.User!.Username,
            Role = profile.User.Role,
            Department = profile.User.Department?.Name,
            DepartmentId = profile.User!.DepartmentId,
            profile.Level, profile.TotalFlightHours, profile.FirstFlightDate,
            profile.Bio, profile.EmergencyContact, profile.EmergencyPhone,
            profile.FlightTypes, profile.Skills, profile.UpdatedAt,
            TrainingRecords = training.Select(t => new
            {
                t.Id, t.CourseName, t.Score, t.ExamDate, t.Examiner, t.Notes, t.CreatedAt
            }),
            CompetitionRecords = competitions.Select(c => new
            {
                c.Id, c.CompetitionName, c.Date, c.Event, c.Ranking, c.Certificate, c.Notes, c.CreatedAt
            })
        };
    }
}
