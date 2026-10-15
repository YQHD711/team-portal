using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>一条结论的摘要（不存正文，只够回看与对比）。</summary>
public record FlightDiagnosisFindingDto(
    string RuleId, string Title, string Severity, string Status, string? Axis);

/// <summary>POST 请求体。字段与 CLI/前端一一对应，服务端只做范围校验，不做语义判断。</summary>
public class FlightDiagnosisInput
{
    public string FileName { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public long Records { get; set; }
    public long SkippedBytes { get; set; }
    public double DurationSec { get; set; }
    public string Vehicle { get; set; } = string.Empty;
    public string VehicleKind { get; set; } = string.Empty;
    public string FirmwareVersion { get; set; } = string.Empty;
    public int VersionNumeric { get; set; }
    public int ParseMs { get; set; }
    public int AnalyzeMs { get; set; }
    public int DecodedTypes { get; set; }
    public int TotalTypes { get; set; }
    public int Critical { get; set; }
    public int Warning { get; set; }
    public int Passed { get; set; }
    public int Unknown { get; set; }
    public List<string> Warnings { get; set; } = new();
    public List<FlightDiagnosisFindingDto> Findings { get; set; } = new();
}

/// <summary>返回给前端的记录（含解析诊断数据，供"解析日志"面板与历史回看使用）。</summary>
public record FlightDiagnosisDto(
    int Id, string FileName, long SizeBytes, long Records, long SkippedBytes, double DurationSec,
    string Vehicle, string VehicleKind, string FirmwareVersion, int VersionNumeric,
    int ParseMs, int AnalyzeMs, int DecodedTypes, int TotalTypes,
    int Critical, int Warning, int Passed, int Unknown,
    IReadOnlyList<string> Warnings, IReadOnlyList<FlightDiagnosisFindingDto> Findings,
    string? CreatedBy, DateTime CreatedAt);

/// <summary>
/// 诊断历史的存取与校验（不依赖 HTTP 上下文，便于直接单测）。
///
/// 可见范围：admin / 部长看全部，普通队员只看自己创建的记录。
/// </summary>
public class FlightDiagnosisService
{
    public const int MaxWarnings = 20;
    public const int MaxWarningLength = 500;
    public const int MaxFindings = 200;
    public const int DefaultLimit = 20;
    public const int MaxLimit = 100;

    /// <summary>是否具备"看全部记录"的可见范围。</summary>
    public static bool CanSeeAll(string? role) => role is "admin" or "部长";

    /// <summary>校验输入；返回 null 表示通过，否则是可直接展示的中文原因。</summary>
    public static string? Validate(FlightDiagnosisInput input)
    {
        if (string.IsNullOrWhiteSpace(input.FileName)) return "fileName 不能为空";
        if (input.FileName.Length > 300) return "fileName 过长（>300）";
        if (input.SizeBytes < 0 || input.SizeBytes > 4L * 1024 * 1024 * 1024) return "sizeBytes 超出范围";
        if (input.Records < 0 || input.Records > 50_000_000) return "records 超出范围";
        if (input.SkippedBytes < 0 || input.SkippedBytes > 4L * 1024 * 1024 * 1024) return "skippedBytes 超出范围";
        if (input.DurationSec < 0 || input.DurationSec > 86_400) return "durationSec 超出范围";
        if (input.Vehicle.Length > 64) return "vehicle 过长";
        if (input.VehicleKind.Length > 32) return "vehicleKind 过长";
        if (input.FirmwareVersion.Length > 64) return "firmwareVersion 过长";
        if (input.VersionNumeric < 0) return "versionNumeric 不能为负";
        if (input.ParseMs < 0 || input.ParseMs > 3_600_000) return "parseMs 超出范围";
        if (input.AnalyzeMs < 0 || input.AnalyzeMs > 3_600_000) return "analyzeMs 超出范围";
        if (input.DecodedTypes < 0 || input.TotalTypes < 0 || input.DecodedTypes > 2_000 || input.TotalTypes > 2_000)
            return "消息类型数超出范围";
        if (input.Critical < 0 || input.Warning < 0 || input.Passed < 0 || input.Unknown < 0)
            return "结论计数不能为负";
        if (input.Critical + input.Warning + input.Passed + input.Unknown > 5_000)
            return "结论计数总和不合理";
        if (input.Warnings.Count > MaxWarnings) return $"warnings 最多 {MaxWarnings} 条";
        if (input.Warnings.Any(w => w is null || w.Length > MaxWarningLength))
            return $"单条 warning 最长 {MaxWarningLength} 字";
        if (input.Findings.Count > MaxFindings) return $"findings 最多 {MaxFindings} 条";
        if (input.Findings.Any(f => f is null || string.IsNullOrWhiteSpace(f.RuleId) || f.Title?.Length > 200))
            return "findings 字段不合法";
        return null;
    }

    public async Task<FlightDiagnosisRecord> CreateAsync(
        AppDbContext db, int userId, string? createdBy, FlightDiagnosisInput input)
    {
        var entity = new FlightDiagnosisRecord
        {
            FileName = input.FileName,
            SizeBytes = input.SizeBytes,
            Records = input.Records,
            SkippedBytes = input.SkippedBytes,
            DurationSec = input.DurationSec,
            Vehicle = input.Vehicle,
            VehicleKind = input.VehicleKind,
            FirmwareVersion = input.FirmwareVersion,
            VersionNumeric = input.VersionNumeric,
            ParseMs = input.ParseMs,
            AnalyzeMs = input.AnalyzeMs,
            DecodedTypes = input.DecodedTypes,
            TotalTypes = input.TotalTypes,
            Critical = input.Critical,
            Warning = input.Warning,
            Passed = input.Passed,
            Unknown = input.Unknown,
            WarningsJson = JsonSerializer.Serialize(input.Warnings),
            FindingsJson = JsonSerializer.Serialize(input.Findings),
            CreatedByUserId = userId,
            CreatedBy = createdBy,
            CreatedAt = DateTime.UtcNow,
        };
        db.FlightDiagnosisRecords.Add(entity);
        await db.SaveChangesAsync();
        return entity;
    }

    public async Task<(int Total, List<FlightDiagnosisRecord> Items)> ListAsync(
        AppDbContext db, string? role, int userId,
        int? limit, int? offset, string? fileName, string? vehicleKind)
    {
        var take = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);
        var skip = Math.Max(offset ?? 0, 0);

        var q = db.FlightDiagnosisRecords.AsNoTracking().AsQueryable();
        if (!CanSeeAll(role)) q = q.Where(x => x.CreatedByUserId == userId);
        if (!string.IsNullOrWhiteSpace(fileName)) q = q.Where(x => x.FileName == fileName);
        if (!string.IsNullOrWhiteSpace(vehicleKind)) q = q.Where(x => x.VehicleKind == vehicleKind);

        var total = await q.CountAsync();
        var items = await q.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id)
            .Skip(skip).Take(take).ToListAsync();
        return (total, items);
    }

    /// <summary>取单条；越权返回 null（端点据此返回 403）。</summary>
    public async Task<FlightDiagnosisRecord?> GetAsync(AppDbContext db, string? role, int userId, int id)
    {
        var entity = await db.FlightDiagnosisRecords.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (entity is null) return null;
        if (!CanSeeAll(role) && entity.CreatedByUserId != userId) return null;
        return entity;
    }

    /// <summary>某个文件名此前的记录数（供"同一日志被诊断过几次"展示）。</summary>
    public Task<int> CountByFileNameAsync(AppDbContext db, string fileName) =>
        db.FlightDiagnosisRecords.AsNoTracking().CountAsync(x => x.FileName == fileName);

    public static FlightDiagnosisDto ToDto(FlightDiagnosisRecord e) => new(
        e.Id, e.FileName, e.SizeBytes, e.Records, e.SkippedBytes, e.DurationSec,
        e.Vehicle, e.VehicleKind, e.FirmwareVersion, e.VersionNumeric,
        e.ParseMs, e.AnalyzeMs, e.DecodedTypes, e.TotalTypes,
        e.Critical, e.Warning, e.Passed, e.Unknown,
        ParseJson<List<string>>(e.WarningsJson) ?? new List<string>(),
        ParseJson<List<FlightDiagnosisFindingDto>>(e.FindingsJson) ?? new List<FlightDiagnosisFindingDto>(),
        e.CreatedBy, e.CreatedAt);

    private static T? ParseJson<T>(string json) where T : class
    {
        try { return JsonSerializer.Deserialize<T>(json, JsonOpts); }
        catch (JsonException) { return null; }
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };
}
