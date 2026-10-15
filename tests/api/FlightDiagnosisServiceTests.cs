using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 诊断历史服务层：校验 + 往返保真 + 可见范围（普通队员只看自己、admin/部长看全部）。
/// 全程内存 sqlite，不碰 HTTP。
/// </summary>
public class FlightDiagnosisServiceTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly FlightDiagnosisService _svc = new();

    public FlightDiagnosisServiceTests()
    {
        var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options);
        _db.Database.EnsureCreated();
    }

    public void Dispose() { _db.Dispose(); GC.SuppressFinalize(this); }

    private static FlightDiagnosisInput ValidInput() => new()
    {
        FileName = "quad_20260617.bin",
        SizeBytes = 9_800_000,
        Records = 229_590,
        SkippedBytes = 0,
        DurationSec = 362.1,
        Vehicle = "ArduCopter",
        VehicleKind = "copter",
        FirmwareVersion = "4.6.2",
        VersionNumeric = 40602,
        ParseMs = 196,
        AnalyzeMs = 12,
        DecodedTypes = 81,
        TotalTypes = 81,
        Critical = 1,
        Warning = 2,
        Passed = 3,
        Unknown = 1,
        Warnings = new List<string> { "跳过了 12 个无法识别的字节" },
        Findings = new List<FlightDiagnosisFindingDto>
        {
            new("vibration_level", "振动超标（IMU0）", "critical", "fired", null),
            new("pid_rate_tracking", "速率环跟踪质量（Roll）", "warning", "fired", "roll"),
        },
    };

    // ── 校验 ────────────────────────────────────────────────────────────────

    [Fact]
    public void Validate_AcceptsWellFormedInput() =>
        Assert.Null(FlightDiagnosisService.Validate(ValidInput()));

    [Fact]
    public void Validate_RejectsOutOfRangeScalars()
    {
        var a = ValidInput(); a.FileName = "   ";
        Assert.Contains("fileName", FlightDiagnosisService.Validate(a)!);

        var b = ValidInput(); b.SizeBytes = -1;
        Assert.Contains("sizeBytes", FlightDiagnosisService.Validate(b)!);

        var c = ValidInput(); c.DurationSec = 999_999;
        Assert.Contains("durationSec", FlightDiagnosisService.Validate(c)!);

        var d = ValidInput(); d.Critical = -1;
        Assert.Contains("不能为负", FlightDiagnosisService.Validate(d)!);

        var e = ValidInput(); e.ParseMs = int.MaxValue;
        Assert.Contains("parseMs", FlightDiagnosisService.Validate(e)!);

        var f = ValidInput(); f.Findings = new List<FlightDiagnosisFindingDto>();
        Assert.Null(FlightDiagnosisService.Validate(f));
    }

    [Fact]
    public void Validate_RejectsUnboundedWarningsAndFindings()
    {
        var tooManyWarnings = ValidInput();
        tooManyWarnings.Warnings = Enumerable.Range(0, FlightDiagnosisService.MaxWarnings + 1)
            .Select(i => $"w{i}").ToList();
        Assert.Contains("warnings", FlightDiagnosisService.Validate(tooManyWarnings)!);

        var tooLongWarning = ValidInput();
        tooLongWarning.Warnings = new List<string> { new string('x', FlightDiagnosisService.MaxWarningLength + 1) };
        Assert.Contains("最长", FlightDiagnosisService.Validate(tooLongWarning)!);

        var tooManyFindings = ValidInput();
        tooManyFindings.Findings = Enumerable.Range(0, FlightDiagnosisService.MaxFindings + 1)
            .Select(i => new FlightDiagnosisFindingDto($"r{i}", "t", "ok", "passed", null)).ToList();
        Assert.Contains("findings", FlightDiagnosisService.Validate(tooManyFindings)!);

        var emptyRuleId = ValidInput();
        emptyRuleId.Findings = new List<FlightDiagnosisFindingDto> { new("", "t", "ok", "passed", null) };
        Assert.Contains("findings", FlightDiagnosisService.Validate(emptyRuleId)!);
    }

    // ── 往返 ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_RoundTripsAllFieldsIncludingJson()
    {
        var saved = await _svc.CreateAsync(_db, userId: 7, createdBy: "alice", ValidInput());
        Assert.True(saved.Id > 0);

        var fetched = await _svc.GetAsync(_db, role: "admin", userId: 1, saved.Id);
        Assert.NotNull(fetched);

        var dto = FlightDiagnosisService.ToDto(fetched!);
        Assert.Equal("quad_20260617.bin", dto.FileName);
        Assert.Equal(229_590, dto.Records);
        Assert.Equal(81, dto.DecodedTypes);
        Assert.Equal(81, dto.TotalTypes);
        Assert.Equal(1, dto.Critical);
        Assert.Equal("alice", dto.CreatedBy);
        Assert.Single(dto.Warnings);
        Assert.Equal(2, dto.Findings.Count);
        Assert.Equal("pid_rate_tracking", dto.Findings[1].RuleId);
        Assert.Equal("roll", dto.Findings[1].Axis);
    }

    [Fact]
    public async Task ToDto_SurvivesCorruptJsonWithoutThrowing()
    {
        var saved = await _svc.CreateAsync(_db, 1, "bob", ValidInput());
        saved.WarningsJson = "{ 这不是数组";
        saved.FindingsJson = "null";
        await _db.SaveChangesAsync();

        var fetched = await _svc.GetAsync(_db, "admin", 1, saved.Id);
        var dto = FlightDiagnosisService.ToDto(fetched!);
        Assert.Empty(dto.Warnings);
        Assert.Empty(dto.Findings);
    }

    // ── 可见范围 ────────────────────────────────────────────────────────────

    [Fact]
    public async Task List_MemberSeesOnlyOwn_StaffSeesAll()
    {
        await _svc.CreateAsync(_db, userId: 1, createdBy: "alice", ValidInput());
        var bobInput = ValidInput(); bobInput.FileName = "bob.bin";
        await _svc.CreateAsync(_db, userId: 2, createdBy: "bob", bobInput);

        var (memberTotal, memberItems) = await _svc.ListAsync(_db, "member", 1, null, null, null, null);
        Assert.Equal(1, memberTotal);
        Assert.All(memberItems, x => Assert.Equal(1, x.CreatedByUserId));

        var (adminTotal, adminItems) = await _svc.ListAsync(_db, "admin", 99, null, null, null, null);
        Assert.Equal(2, adminTotal);
        Assert.Equal(2, adminItems.Count);

        var (ministerTotal, _) = await _svc.ListAsync(_db, "部长", 99, null, null, null, null);
        Assert.Equal(2, ministerTotal);
    }

    [Fact]
    public async Task List_ClampsLimitAndFiltersByFileNameAndKind()
    {
        await _svc.CreateAsync(_db, 1, "alice", ValidInput());
        var other = ValidInput(); other.FileName = "other.bin"; other.VehicleKind = "plane";
        await _svc.CreateAsync(_db, 1, "alice", other);

        var (allTotal, allItems) = await _svc.ListAsync(_db, "admin", 1, limit: 999, offset: 0, null, null);
        Assert.Equal(2, allTotal);
        Assert.Equal(2, allItems.Count);

        var (zeroLimitTotal, zeroLimitItems) = await _svc.ListAsync(_db, "admin", 1, limit: 0, offset: 0, null, null);
        Assert.Equal(2, zeroLimitTotal);          // total 不受 limit 影响
        Assert.Single(zeroLimitItems);            // limit 被夹到下限 1

        var (byName, byNameItems) = await _svc.ListAsync(_db, "admin", 1, null, null, "other.bin", null);
        Assert.Equal(1, byName);
        Assert.Equal("plane", byNameItems[0].VehicleKind);

        var (byKind, _) = await _svc.ListAsync(_db, "admin", 1, null, null, null, "copter");
        Assert.Equal(1, byKind);

        var (paged, pagedItems) = await _svc.ListAsync(_db, "admin", 1, limit: 1, offset: 1, null, null);
        Assert.Equal(2, paged);
        Assert.Single(pagedItems);
    }

    [Fact]
    public async Task Get_CrossUserReturnsNull_MissingReturnsNull()
    {
        var saved = await _svc.CreateAsync(_db, userId: 1, createdBy: "alice", ValidInput());

        Assert.NotNull(await _svc.GetAsync(_db, "member", 1, saved.Id));
        Assert.NotNull(await _svc.GetAsync(_db, "admin", 42, saved.Id));
        Assert.Null(await _svc.GetAsync(_db, "member", 2, saved.Id));   // 越权
        Assert.Null(await _svc.GetAsync(_db, "admin", 1, 99_999));      // 不存在
    }

    [Fact]
    public async Task CountByFileName_CountsSameFileDiagnoses()
    {
        await _svc.CreateAsync(_db, 1, "alice", ValidInput());
        await _svc.CreateAsync(_db, 2, "bob", ValidInput());
        var other = ValidInput(); other.FileName = "x.bin";
        await _svc.CreateAsync(_db, 1, "alice", other);

        Assert.Equal(2, await _svc.CountByFileNameAsync(_db, "quad_20260617.bin"));
        Assert.Equal(1, await _svc.CountByFileNameAsync(_db, "x.bin"));
        Assert.Equal(0, await _svc.CountByFileNameAsync(_db, "nope.bin"));
    }
}
