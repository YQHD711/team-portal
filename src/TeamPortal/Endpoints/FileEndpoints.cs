using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace TeamPortal.Endpoints;

public static class FileEndpoints
{
    private static string UploadDir() => Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "files"));

    /// <summary>上传类型白名单：常见文档/图片/压缩格式。svg 有 XSS 风险已排除；下载统一强制 attachment。</summary>
    private static readonly HashSet<string> AllowedUploadExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".ppt", ".pptx",
        ".md", ".txt", ".json",
        ".zip", ".rar", ".7z",
        ".jpg", ".jpeg", ".png", ".gif", ".webp"
    };

    /// <summary>带点号包裹的危险扩展名段(双扩展名混淆检测用)</summary>
    private static readonly string[] DangerousExtSegments = [".php.", ".asp.", ".aspx.", ".jsp.", ".exe.", ".sh.", ".js.", ".html.", ".htm.", ".svg."];

    private static async Task<(string? role, string? dept, int id)> GetCtx(ClaimsPrincipal user, AppDbContext db)
    {
        var idClaim = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null) return (null, null, 0);
        var u = await db.Users.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == int.Parse(idClaim));
        return u is null ? (null, null, 0) : (u.Role, u.Department?.Name, u.Id);
    }

    public static void MapFileEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/files").RequireAuthorization();

        // List files — filtered by visibility
        g.MapGet("/", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var (role, dept, _) = await GetCtx(user, db);
            var query = db.SharedFiles.AsQueryable();
            if (role != "admin" && role != "部长")
                query = query.Where(f => f.Visibility == "public" || (f.Visibility == "department" && f.Department == dept));
            var files = await query.OrderByDescending(f => f.CreatedAt).Take(50).ToListAsync();
            return Results.Ok(files.Select(f => new { f.Id, f.OriginalName, f.ContentType, f.Size, f.Visibility, f.Department, f.UploaderName, f.CreatedAt }));
        });

        // Upload
        g.MapPost("/upload", async (IFormFile file, string? visibility, ClaimsPrincipal user, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            if (file is null || file.Length == 0) return Results.Problem("No file", statusCode: 400);
            if (file.Length > 100 * 1024 * 1024) return Results.Problem("Max 100MB", statusCode: 400);

            // 文件名规范化：拒绝路径分隔符、.. 等危险字符（虽然存储名用 GUID，原始名仍会入库/渲染）
            var rawName = file.FileName ?? "";
            if (rawName.Contains('/') || rawName.Contains('\\') || rawName.Contains(".."))
                return Results.Problem("文件名包含非法字符（路径分隔符或 ..）", statusCode: 400);

            // 扩展名白名单（.html/.svg/.exe 等一律拒绝）
            var uploadExt = Path.GetExtension(rawName);
            if (string.IsNullOrEmpty(uploadExt) || !AllowedUploadExtensions.Contains(uploadExt))
                return Results.Problem(
                    $"不支持的文件类型 {uploadExt}。允许: pdf/doc/docx/xls/xlsx/csv/ppt/pptx/md/txt/json/zip/rar/7z/jpg/jpeg/png/gif/webp",
                    statusCode: 415);

            // 双扩展名混淆（shell.php.jpg、a.asp.png 等）:白名单只认最后一个扩展名,需额外拦截
            // 危险扩展名段必须带点号包裹,避免误伤 doc.v2.docx、2026-08-10.log.pdf 等正常多段文件名
            if (DangerousExtSegments.Any(s => rawName.Contains(s, StringComparison.OrdinalIgnoreCase)))
                return Results.Problem("文件名包含非法扩展名组合", statusCode: 400);

            var (role, dept, uid) = await GetCtx(user, db);
            var vis = visibility == "department" && !string.IsNullOrEmpty(dept) ? "department" : "public";
            var actor = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";

            Directory.CreateDirectory(UploadDir());
            var storedName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
            var path = Path.Combine(UploadDir(), storedName);
            await using (var fs = File.Create(path))
                await file.CopyToAsync(fs);

            var sf = new SharedFile
            {
                FileName = storedName, OriginalName = file.FileName,
                ContentType = file.ContentType ?? "application/octet-stream",
                Size = file.Length, Visibility = vis, Department = vis == "department" ? dept : null,
                UploaderId = uid, UploaderName = actor
            };
            db.SharedFiles.Add(sf);
            await db.SaveChangesAsync();
            log.Info("files", $"File uploaded: {file.FileName} ({file.Length} bytes) by {actor}", $"{{\"visibility\":\"{vis}\",\"id\":{sf.Id}}}");
            log.Audit("upload", actor, targetType: "file", targetId: sf.Id.ToString(),
                data: new { name = file.FileName, size = file.Length, visibility = vis }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { sf.Id, sf.OriginalName, sf.Size, sf.Visibility });
        }).DisableAntiforgery();

        // Download
        g.MapGet("/{id:int}/download", async (int id, ClaimsPrincipal user, AppDbContext db, LogService log) =>
        {
            var (role, dept, _) = await GetCtx(user, db);
            var f = await db.SharedFiles.FindAsync(id);
            if (f is null) return Results.Problem("Not found", statusCode: 404);
            if (f.Visibility == "department" && role != "admin" && f.Department != dept)
                return Results.Problem("Access denied", statusCode: 403);

            var path = Path.Combine(UploadDir(), f.FileName);
            if (!File.Exists(path)) return Results.Problem("File missing", statusCode: 404);
            var actor = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            log.Info("files", $"File downloaded: {f.OriginalName} by {actor}");
            return Results.File(path, f.ContentType, f.OriginalName);
        });

        // Delete (staff only)
        g.MapDelete("/{id:int}", async (int id, ClaimsPrincipal user, AppDbContext db, LogService log, HttpContext ctx) =>
        {
            var (role, _, _) = await GetCtx(user, db);
            if (role != "admin" && role != "部长") return Results.Problem("仅管理员和部长可删除", statusCode: 403);
            var f = await db.SharedFiles.FindAsync(id);
            if (f is null) return Results.Problem("Not found", statusCode: 404);
            var actor = user.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            var path = Path.Combine(UploadDir(), f.FileName);
            try { if (File.Exists(path)) File.Delete(path); } catch { }
            db.SharedFiles.Remove(f);
            await db.SaveChangesAsync();
            log.Warn("files", $"File deleted: {f.OriginalName} by {actor}");
            log.Audit("delete", actor, targetType: "file", targetId: id.ToString(),
                data: new { name = f.OriginalName }, ipAddress: LogService.ClientIp(ctx));
            return Results.Ok(new { success = true });
        });
    }
}
