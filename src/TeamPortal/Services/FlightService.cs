using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class FlightService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    public FlightService(AppDbContext db, LogService log) { _db = db; _log = log; }

    // ── Battery ──

    public async Task<List<BatteryRecord>> GetBatteries()
        => await _db.BatteryRecords.OrderBy(b => b.BatteryNumber).ToListAsync();

    public async Task<BatteryRecord> CreateBattery(string number, string? health, DateTime incidentDate, string? notes)
    {
        var b = new BatteryRecord { BatteryNumber = number, Health = health ?? "正常", IncidentDate = incidentDate, Notes = notes };
        _db.BatteryRecords.Add(b); await _db.SaveChangesAsync();
        _log.Info("flight", $"Battery incident recorded: {number}");
        return b;
    }

    public async Task<bool> UpdateBattery(int id, string? number, string? health, DateTime? incidentDate, string? notes)
    {
        var b = await _db.BatteryRecords.FindAsync(id);
        if (b is null) return false;
        if (number is not null) b.BatteryNumber = number;
        if (health is not null) b.Health = health;
        if (incidentDate.HasValue) b.IncidentDate = incidentDate.Value;
        if (notes is not null) b.Notes = notes;
        await _db.SaveChangesAsync(); return true;
    }

    public async Task<bool> DeleteBattery(int id)
    {
        var b = await _db.BatteryRecords.FindAsync(id);
        if (b is null) return false;
        _db.BatteryRecords.Remove(b); await _db.SaveChangesAsync(); return true;
    }

    // ── Incidents ──

    /// <summary>按调用者角色过滤事故:
    /// - admin: 全部
    /// - 部长: 仅本部门成员提交
    /// - member: 仅自己提交</summary>
    public async Task<List<IncidentRecord>> GetIncidents(int callerUserId, string? callerRole, string? callerDeptName, int? callerDeptId, int page = 1, int pageSize = 50)
    {
        var q = _db.IncidentRecords.AsQueryable();
        if (callerRole == "admin")
        {
            // 全部可见
        }
        else if (callerRole == "部长")
        {
            if (callerDeptId.HasValue)
            {
                // 本部门成员(userIds) + 自己(若未关联 DepartmentId)
                var memberIds = _db.Users.Where(u => u.DepartmentId == callerDeptId.Value && u.Role != "admin").Select(u => u.Id).ToList();
                q = q.Where(i => (i.ReporterUserId != null && memberIds.Contains(i.ReporterUserId.Value)) || i.ReporterUserId == callerUserId);
            }
            else
            {
                q = q.Where(i => i.ReporterUserId == callerUserId);
            }
        }
        else
        {
            // 普通成员:只看自己
            q = q.Where(i => i.ReporterUserId == callerUserId);
        }
        return await q.OrderByDescending(i => i.Date).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
    }

    public async Task<IncidentRecord> CreateIncident(string type, string severity, string description,
        DateTime date, string? resolution, string? reportedBy, int reporterUserId, int? departmentId)
    {
        var i = new IncidentRecord
        {
            Type = type, Severity = severity, Description = description, Date = date,
            Resolution = resolution, ReportedBy = reportedBy,
            ReporterUserId = reporterUserId, DepartmentId = departmentId
        };
        _db.IncidentRecords.Add(i); await _db.SaveChangesAsync();
        _log.Warn("flight", $"Incident reported: {type} ({severity}) by user#{reporterUserId}");
        return i;
    }

    public async Task<bool> UpdateIncident(int id, string? type, string? severity, string? description,
        DateTime? date, string? resolution)
    {
        var i = await _db.IncidentRecords.FindAsync(id);
        if (i is null) return false;
        if (type is not null) i.Type = type;
        if (severity is not null) i.Severity = severity;
        if (description is not null) i.Description = description;
        if (date.HasValue) i.Date = date.Value;
        if (resolution is not null) i.Resolution = resolution;
        await _db.SaveChangesAsync(); return true;
    }

    public async Task<bool> DeleteIncident(int id)
    {
        var i = await _db.IncidentRecords.FindAsync(id);
        if (i is null) return false;
        _db.IncidentRecords.Remove(i); await _db.SaveChangesAsync(); return true;
    }
}
