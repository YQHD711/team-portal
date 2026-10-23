using Microsoft.Data.Sqlite;

namespace TeamPortal.Endpoints;

/// <summary>
/// 下载区：目前只有精臣打印服务安装包（浏览器无法直接驱动打印机，必须在本机装这个桥接服务）。
/// 安装包放在数据目录 data/downloads/ 下，不进 git（38MB 的厂商二进制，且需要用户已接受厂商许可）。
/// </summary>
public static class DownloadEndpoints
{
    public const string PrintServiceFileName = "jcPrinterSdk_4.2.1_20260902.exe";

    public static void MapDownloadEndpoints(this WebApplication app)
    {
        app.MapGet("/api/downloads/print-service", (IConfiguration config, IWebHostEnvironment env) =>
        {
            var path = ResolvePrintServicePath(config, env.ContentRootPath);
            if (path is null || !File.Exists(path))
                return Results.Problem("打印服务安装包尚未部署到服务器，请联系管理员", statusCode: 404);

            return Results.File(path, "application/octet-stream", PrintServiceFileName, enableRangeProcessing: true);
        }).RequireAuthorization();
    }

    /// <summary>
    /// 解析安装包路径：优先 Downloads:PrintServicePath；否则放在数据库同目录的 downloads/ 下
    /// （容器里连接串是 Data Source=/data/teamportal.db → /data/downloads/...）。
    /// </summary>
    internal static string? ResolvePrintServicePath(IConfiguration config, string contentRoot)
    {
        var configured = config["Downloads:PrintServicePath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return Path.IsPathRooted(configured) ? configured : Path.GetFullPath(Path.Combine(contentRoot, configured));

        var connectionString = config.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString)) return null;

        string? dataSource;
        try { dataSource = new SqliteConnectionStringBuilder(connectionString).DataSource; }
        catch { return null; }
        if (string.IsNullOrWhiteSpace(dataSource)) return null;

        var dbPath = Path.IsPathRooted(dataSource)
            ? dataSource
            : Path.GetFullPath(Path.Combine(contentRoot, dataSource));
        var dir = Path.GetDirectoryName(dbPath);
        return string.IsNullOrEmpty(dir) ? null : Path.Combine(dir, "downloads", PrintServiceFileName);
    }
}
