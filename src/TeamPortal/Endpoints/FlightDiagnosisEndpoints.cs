using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

/// <summary>
/// 诊断历史端点（契约见 docs/日志诊断-接口契约.md §0.5.4）。
///
/// 权限：POST 任意已登录用户；GET 列表/详情 admin 与部长看全部，普通队员只看自己创建的。
/// 角色从**数据库**读（<see cref="CurrentUser.FromDbAsync"/>），不用 JWT 声明做数据可见性判断。
/// </summary>
public static class FlightDiagnosisEndpoints
{
    public static void MapFlightDiagnosisEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/flight-diagnoses").RequireAuthorization();

        group.MapPost("/", async (
            FlightDiagnosisInput input, FlightDiagnosisService svc, AppDbContext db,
            ClaimsPrincipal user, LogService log, HttpContext ctx) =>
        {
            var (_, _, uid) = await CurrentUser.FromDbAsync(user, db);
            if (uid == 0) return Results.Problem("未登录或账号已删除", statusCode: 401);

            var error = FlightDiagnosisService.Validate(input);
            if (error is not null) return Results.Problem(error, statusCode: 400);

            var username = await db.Users.AsNoTracking()
                .Where(u => u.Id == uid).Select(u => u.Username).FirstOrDefaultAsync();

            var record = await svc.CreateAsync(db, uid, username ?? "unknown", input);

            // 运行日志：解析是否完整、结论分布、耗时，一眼能看出"某次诊断到底发生了什么"
            log.Info("flightdiagnosis",
                $"诊断 {record.FileName}（{record.Vehicle} {record.FirmwareVersion}）：" +
                $"严重 {record.Critical} / 警告 {record.Warning} / 无法判断 {record.Unknown} / 通过 {record.Passed}，" +
                $"记录 {record.Records} 条，跳过 {record.SkippedBytes} 字节，" +
                $"解析覆盖 {record.DecodedTypes}/{record.TotalTypes} 类型，耗时 {record.ParseMs + record.AnalyzeMs} ms",
                detail: record.SkippedBytes > 0 || record.DecodedTypes < record.TotalTypes ? "解析不完整" : null,
                user: username);
            log.Audit("flight-diagnosis", username ?? "unknown", targetType: "flight-diagnosis",
                targetId: record.Id.ToString(), data: new { record.FileName, record.Records, record.SkippedBytes },
                ipAddress: LogService.ClientIp(ctx));

            return Results.Ok(new { id = record.Id, createdAt = record.CreatedAt });
        });

        group.MapGet("/", async (
            int? limit, int? offset, string? fileName, string? vehicleKind,
            FlightDiagnosisService svc, AppDbContext db, ClaimsPrincipal user) =>
        {
            var (role, _, uid) = await CurrentUser.FromDbAsync(user, db);
            var (total, items) = await svc.ListAsync(db, role, uid, limit, offset, fileName, vehicleKind);
            return Results.Ok(new
            {
                total,
                items = items.Select(FlightDiagnosisService.ToDto).ToList(),
            });
        });

        group.MapGet("/{id:int}", async (
            int id, FlightDiagnosisService svc, AppDbContext db, ClaimsPrincipal user) =>
        {
            var (role, _, uid) = await CurrentUser.FromDbAsync(user, db);
            var record = await svc.GetAsync(db, role, uid, id);
            if (record is null)
            {
                // 存在但越权 → 403；不存在 → 404。两者都返回可读原因。
                var exists = await db.FlightDiagnosisRecords.AsNoTracking().AnyAsync(x => x.Id == id);
                return exists
                    ? Results.Problem("无权查看该诊断记录", statusCode: 403)
                    : Results.Problem("诊断记录不存在", statusCode: 404);
            }
            return Results.Ok(FlightDiagnosisService.ToDto(record));
        });
    }
}
