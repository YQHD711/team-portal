using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TeamPortal.Data;
using TeamPortal.Services;

namespace api;

/// <summary>百度网盘测试基座：假 HTTP 处理器 + 可观测日志 + 服务构造。</summary>
internal sealed record BaiduTestContext(
    BaiduNetdiskService Service, FakeBaiduHandler Handler, RecordingLogger<LogService> Logger);

/// <summary>记录所有日志消息，用于断言敏感信息不落日志。</summary>
internal sealed class RecordingLogger<T> : ILogger<T>
{
    public List<string> Messages { get; } = new();
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
}

/// <summary>假 HTTP 处理器：记录每个请求的 URL/body，响应由测试函数决定。</summary>
internal sealed class FakeBaiduHandler : HttpMessageHandler
{
    private readonly Func<string, string, int, HttpResponseMessage> _respond;

    public List<string> Urls { get; } = new();
    public List<string> Bodies { get; } = new();

    /// <param name="respond">(url, body, 业务调用序号) → 响应；序号不含 OAuth 刷新调用</param>
    public FakeBaiduHandler(Func<string, string, int, HttpResponseMessage> respond) => _respond = respond;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var url = request.RequestUri!.ToString();
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
        Urls.Add(url);
        Bodies.Add(body);
        return _respond(url, body, Urls.Count - 1);
    }

    public int CountCalls(string fragment) => Urls.Count(u => u.Contains(fragment, StringComparison.Ordinal));
    public int IndexOfCall(string fragment) => Urls.FindIndex(u => u.Contains(fragment, StringComparison.Ordinal));
    public string BodyOfCall(int index) => Bodies[index];

    public static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    /// <summary>取出 form-urlencoded 请求体里的字段值。</summary>
    public static string FormField(string body, string key)
        => Uri.UnescapeDataString(body.Split('&')
            .Select(p => p.Split('=', 2))
            .First(p => p.Length == 2 && Uri.UnescapeDataString(p[0]) == key)[1]);
}

internal static class BaiduTestFactory
{
    /// <summary>OAuth 刷新成功的响应体（授权码交换走测试自己的 respond）。</summary>
    private const string RefreshTokenJson =
        "{\"access_token\":\"fake-access-token\",\"refresh_token\":\"fake-refresh-token\",\"expires_in\":2592000,\"scope\":\"basic netdisk\"}";

    public static BaiduTestContext Create(Func<string, string, int, HttpResponseMessage> respond)
    {
        EnsureRefreshTokenFile();
        var apiCall = 0;
        var handler = new FakeBaiduHandler((url, body, _) =>
            url.Contains("grant_type=refresh_token", StringComparison.Ordinal)
                ? FakeBaiduHandler.Json(RefreshTokenJson)
                : respond(url, body, apiCall++));

        var db = CreateDb();
        var scopes = new TestScopeFactory(db);
        var settings = new SettingsService(scopes);
        var logger = new RecordingLogger<LogService>();
        var log = new LogService(scopes, logger, settings);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Baidu:AppKey"] = "test-app-key",
            ["Baidu:SecretKey"] = "test-secret-key",
        }).Build();

        return new BaiduTestContext(new BaiduNetdiskService(new HttpClient(handler), config, log, settings), handler, logger);
    }

    private static AppDbContext CreateDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        return db;
    }

    /// <summary>GetAccessToken 会读这个文件（路径由服务的 TokenFile 决定），保证刷新流程可走通。</summary>
    private static void EnsureRefreshTokenFile()
    {
        var path = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data", "baidu-token.json"));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        if (!File.Exists(path)) File.WriteAllText(path, "{\"refresh_token\":\"test-refresh-token\"}");
    }
}
