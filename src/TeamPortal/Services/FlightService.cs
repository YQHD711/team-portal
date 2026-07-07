using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

public class FlightService
{
    private readonly AppDbContext _db;
    private readonly LogService _log;

    public FlightService(AppDbContext db, LogService log) { _db = db; _log = log; }

    // ── Flight Records ──

    public async Task<List<FlightRecord>> GetFlights(int? pilotUserId, int page = 1, int pageSize = 50)
    {
        var q = _db.FlightRecords.Include(f => f.Pilot).AsQueryable();
        if (pilotUserId.HasValue) q = q.Where(f => f.PilotUserId == pilotUserId.Value);
        return await q.OrderByDescending(f => f.TakeoffTime).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
    }

    public async Task<FlightRecord?> GetFlight(int id)
        => await _db.FlightRecords.Include(f => f.Pilot).FirstOrDefaultAsync(f => f.Id == id);

    public async Task<FlightRecord> CreateFlight(int pilotUserId, string aircraftModel, DateTime takeoffTime,
        DateTime? landingTime, double? durationMinutes, string? location, string? weather, string? notes, string? logFileName, string? batteryNumber)
    {
        var f = new FlightRecord
        {
            PilotUserId = pilotUserId, AircraftModel = aircraftModel, TakeoffTime = takeoffTime,
            LandingTime = landingTime, DurationMinutes = durationMinutes, Location = location,
            Weather = weather, Notes = notes, LogFileName = logFileName, BatteryNumber = batteryNumber
        };
        _db.FlightRecords.Add(f); await _db.SaveChangesAsync();

        // Update pilot flight hours
        var profile = await _db.PilotProfiles.FirstOrDefaultAsync(p => p.UserId == pilotUserId);
        if (profile is not null && durationMinutes.HasValue)
        {
            profile.TotalFlightHours += durationMinutes.Value / 60.0;
            profile.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
        _log.Info("flight", $"Flight recorded: {aircraftModel}, pilot={pilotUserId}");
        return f;
    }

    public async Task<bool> UpdateFlight(int id, string? aircraftModel, DateTime? takeoffTime,
        DateTime? landingTime, double? durationMinutes, string? location, string? weather, string? notes, string? batteryNumber)
    {
        var f = await _db.FlightRecords.FindAsync(id);
        if (f is null) return false;
        if (aircraftModel is not null) f.AircraftModel = aircraftModel;
        if (takeoffTime.HasValue) f.TakeoffTime = takeoffTime.Value;
        if (landingTime.HasValue) f.LandingTime = landingTime;
        if (durationMinutes.HasValue) f.DurationMinutes = durationMinutes;
        if (location is not null) f.Location = location;
        if (weather is not null) f.Weather = weather;
        if (notes is not null) f.Notes = notes;
        if (batteryNumber is not null) f.BatteryNumber = batteryNumber;
        await _db.SaveChangesAsync(); return true;
    }

    public async Task<bool> DeleteFlight(int id)
    {
        var f = await _db.FlightRecords.FindAsync(id);
        if (f is null) return false;
        _db.FlightRecords.Remove(f); await _db.SaveChangesAsync(); return true;
    }

    public async Task<object> GetFlightStats()
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var flights = await _db.FlightRecords.ToListAsync();
        var thisMonth = flights.Where(f => f.TakeoffTime >= monthStart).ToList();
        return new
        {
            totalFlights = flights.Count,
            thisMonthFlights = thisMonth.Count,
            totalHours = Math.Round(flights.Sum(f => f.DurationMinutes ?? 0) / 60.0, 1),
            thisMonthHours = Math.Round(thisMonth.Sum(f => f.DurationMinutes ?? 0) / 60.0, 1),
            topPilots = flights.GroupBy(f => f.PilotUserId)
                .Select(g => new { userId = g.Key, count = g.Count(), hours = Math.Round(g.Sum(f => f.DurationMinutes ?? 0) / 60.0, 1) })
                .OrderByDescending(x => x.hours).Take(5),
            recentFlights = flights.OrderByDescending(f => f.TakeoffTime).Take(10).Select(f => new
            {
                f.Id, f.AircraftModel, f.TakeoffTime, f.DurationMinutes, f.Location, f.PilotUserId
            })
        };
    }

    // ── Battery ──

    public async Task<List<BatteryRecord>> GetBatteries()
        => await _db.BatteryRecords.OrderBy(b => b.BatteryNumber).ToListAsync();

    public async Task<BatteryRecord> CreateBattery(string number, int cycles, double? capacity, string? health, string? notes)
    {
        var b = new BatteryRecord { BatteryNumber = number, CycleCount = cycles, CapacityMAh = capacity, Health = health ?? "正常", Notes = notes };
        _db.BatteryRecords.Add(b); await _db.SaveChangesAsync();
        _log.Info("flight", $"Battery added: {number}");
        return b;
    }

    public async Task<bool> UpdateBattery(int id, string? number, int? cycles, double? capacity, string? health, string? notes)
    {
        var b = await _db.BatteryRecords.FindAsync(id);
        if (b is null) return false;
        if (number is not null) b.BatteryNumber = number;
        if (cycles.HasValue) b.CycleCount = cycles.Value;
        if (capacity.HasValue) b.CapacityMAh = capacity;
        if (health is not null) b.Health = health;
        if (notes is not null) b.Notes = notes;
        b.LastUsedDate = DateTime.UtcNow;
        await _db.SaveChangesAsync(); return true;
    }

    public async Task<bool> DeleteBattery(int id)
    {
        var b = await _db.BatteryRecords.FindAsync(id);
        if (b is null) return false;
        _db.BatteryRecords.Remove(b); await _db.SaveChangesAsync(); return true;
    }

    // ── Incidents ──

    public async Task<List<IncidentRecord>> GetIncidents(int page = 1, int pageSize = 50)
        => await _db.IncidentRecords.OrderByDescending(i => i.Date).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

    public async Task<IncidentRecord> CreateIncident(string type, string severity, string description,
        DateTime date, int? relatedFlightId, string? resolution, string? reportedBy)
    {
        var i = new IncidentRecord
        {
            Type = type, Severity = severity, Description = description, Date = date,
            RelatedFlightId = relatedFlightId, Resolution = resolution, ReportedBy = reportedBy
        };
        _db.IncidentRecords.Add(i); await _db.SaveChangesAsync();
        _log.Warn("flight", $"Incident reported: {type} ({severity})");
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
