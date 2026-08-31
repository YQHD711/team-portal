using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class CertificationService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    public CertificationService(AppDbContext db, LogService log) { _db = db; _log = log; }

    // ── Personal skill certifications ──

    public async Task<List<SkillCertification>> GetCertifications(int userId)
    {
        return await _db.SkillCertifications
            .Where(c => c.UserId == userId)
            .OrderByDescending(c => c.CertDate).ThenByDescending(c => c.Id)
            .ToListAsync();
    }

    public async Task<List<object>> ListAllCertifications()
    {
        return await _db.SkillCertifications
            .Include(c => c.User)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id, c.UserId, Username = c.User!.Username,
                c.CertName, c.Level, c.Status, c.CertDate, c.Notes, c.CreatedAt
            })
            .ToListAsync<object>();
    }

    public async Task<SkillCertification> AddCertification(int userId, string certName, string level,
        string status, DateTime? certDate, string? notes)
    {
        var cert = new SkillCertification
        {
            UserId = userId, CertName = certName, Level = level,
            Status = status, CertDate = certDate, Notes = notes
        };
        _db.SkillCertifications.Add(cert);
        await _db.SaveChangesAsync();
        _log.Info("certification", $"Certification added for user {userId}: {certName} ({status})");
        return cert;
    }

    public async Task<bool> UpdateCertification(int id, string? certName, string? level,
        string? status, DateTime? certDate, string? notes)
    {
        var cert = await _db.SkillCertifications.FindAsync(id);
        if (cert is null) return false;
        if (certName is not null) cert.CertName = certName;
        if (level is not null) cert.Level = level;
        if (status is not null) cert.Status = status;
        if (certDate.HasValue) cert.CertDate = certDate;
        if (notes is not null) cert.Notes = notes;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteCertification(int id)
    {
        var cert = await _db.SkillCertifications.FindAsync(id);
        if (cert is null) return false;
        _db.SkillCertifications.Remove(cert);
        await _db.SaveChangesAsync();
        return true;
    }
}
