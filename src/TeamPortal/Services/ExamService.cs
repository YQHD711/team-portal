using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class ExamService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    public ExamService(AppDbContext db, LogService log) { _db = db; _log = log; }

    // ── Department exams ──

    public async Task<List<object>> ListExams(int? departmentId)
    {
        var query = _db.DepartmentExams.Include(e => e.Department).AsQueryable();
        if (departmentId.HasValue) query = query.Where(e => e.DepartmentId == departmentId.Value);
        var exams = await query.OrderByDescending(e => e.ExamDate).ThenByDescending(e => e.Id).ToListAsync();
        return exams.Select(e => new
        {
            e.Id, e.DepartmentId, Department = e.Department?.Name,
            e.Title, e.ExamType, e.Status, e.ExamDate, e.CreatedByUserId, e.CreatedAt,
            ResultCount = _db.DepartmentExamResults.Count(r => r.ExamId == e.Id),
            PassedCount = _db.DepartmentExamResults.Count(r => r.ExamId == e.Id && r.Passed)
        }).ToList<object>();
    }

    public async Task<DepartmentExam> CreateExam(int departmentId, string title, string examType,
        string status, DateTime? examDate, int createdByUserId)
    {
        var exam = new DepartmentExam
        {
            DepartmentId = departmentId, Title = title, ExamType = examType,
            Status = status, ExamDate = examDate, CreatedByUserId = createdByUserId
        };
        _db.DepartmentExams.Add(exam);
        await _db.SaveChangesAsync();
        _log.Info("exam", $"Exam created: {title} (dept {departmentId})");
        return exam;
    }

    public async Task<bool> UpdateExam(int id, int? departmentId, string? title, string? examType,
        string? status, DateTime? examDate)
    {
        var exam = await _db.DepartmentExams.FindAsync(id);
        if (exam is null) return false;
        if (departmentId.HasValue) exam.DepartmentId = departmentId.Value;
        if (title is not null) exam.Title = title;
        if (examType is not null) exam.ExamType = examType;
        if (status is not null) exam.Status = status;
        if (examDate.HasValue) exam.ExamDate = examDate;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteExam(int id)
    {
        var exam = await _db.DepartmentExams.FindAsync(id);
        if (exam is null) return false;
        _db.DepartmentExams.Remove(exam);
        await _db.SaveChangesAsync();
        _log.Warn("exam", $"Exam deleted: {exam.Title}");
        return true;
    }

    // ── Exam results ──

    public async Task<List<object>> GetResults(int examId)
    {
        return await _db.DepartmentExamResults
            .Where(r => r.ExamId == examId)
            .Include(r => r.User)
            .OrderBy(r => r.User!.Username)
            .Select(r => new
            {
                r.Id, r.ExamId, r.UserId, Username = r.User!.Username,
                r.Passed, r.Score, r.Notes, r.CreatedAt
            })
            .ToListAsync<object>();
    }

    /// <summary>所有通过记录(供组织架构页团队认证展示): 按用户分组带考核标题。</summary>
    public async Task<List<object>> ListPassedResults()
    {
        return await ListPassedResultsCore(null);
    }

    /// <summary>单个队员的通过记录(个人端只读展示)。</summary>
    public async Task<List<object>> ListPassedResults(int userId)
    {
        return await ListPassedResultsCore(userId);
    }

    private async Task<List<object>> ListPassedResultsCore(int? userId)
    {
        var query = _db.DepartmentExamResults
            .Where(r => r.Passed)
            .Include(r => r.User)
            .Include(r => r.Exam)
            .AsQueryable();
        if (userId.HasValue) query = query.Where(r => r.UserId == userId.Value);
        return await query
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new
            {
                r.Id, r.UserId, Username = r.User!.Username,
                r.ExamId, ExamTitle = r.Exam!.Title,
                ExamType = r.Exam!.ExamType, ExamDate = r.Exam!.ExamDate,
                r.Score, r.Notes, r.CreatedAt
            })
            .ToListAsync<object>();
    }

    /// <summary>批量录入结果;同一 (ExamId, UserId) 重复录入时更新原记录(唯一索引)。</summary>
    public async Task<List<DepartmentExamResult>> AddResults(int examId, List<ExamResultInput> inputs)
    {
        var results = new List<DepartmentExamResult>();
        foreach (var input in inputs)
        {
            var existing = await _db.DepartmentExamResults
                .FirstOrDefaultAsync(r => r.ExamId == examId && r.UserId == input.UserId);
            if (existing is not null)
            {
                existing.Passed = input.Passed;
                if (input.Score.HasValue) existing.Score = input.Score;
                if (input.Notes is not null) existing.Notes = input.Notes;
                results.Add(existing);
            }
            else
            {
                var result = new DepartmentExamResult
                {
                    ExamId = examId, UserId = input.UserId,
                    Passed = input.Passed, Score = input.Score, Notes = input.Notes
                };
                _db.DepartmentExamResults.Add(result);
                results.Add(result);
            }
        }
        await _db.SaveChangesAsync();
        _log.Info("exam", $"Exam #{examId}: {results.Count} result(s) recorded");
        return results;
    }

    public async Task<bool> DeleteResult(int id)
    {
        var result = await _db.DepartmentExamResults.FindAsync(id);
        if (result is null) return false;
        _db.DepartmentExamResults.Remove(result);
        await _db.SaveChangesAsync();
        return true;
    }
}

public record ExamResultInput(int UserId, bool Passed, double? Score, string? Notes);
