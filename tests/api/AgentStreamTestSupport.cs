using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Services;

namespace api;

/// <summary>
/// task-13 流式端点的测试夹具：脚本化假上游（不真调 DeepSeek）、独立 DB、admin/member 登录。
/// 与 <see cref="SystemAgentStreamTests"/> 分开，保证测试文件本身 &lt;200 行。
/// </summary>
internal static class AgentStreamTestSupport
{
    public const string Sse = "data: {\"choices\":[{\"delta\":{\"content\":\"最终回答\"}}]}\n\ndata: [DONE]\n\n";

    public sealed record LoginResp(string Token);

    public static HttpClient Client(WebApplicationFactory<Program> factory, string dbPath, ScriptedHandler handler)
        => factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:DefaultConnection", "Data Source=" + dbPath);
            b.UseSetting("Jwt:Key", new string('k', 40));
            b.UseSetting("Jwt:Issuer", "TeamPortal");
            b.UseSetting("Jwt:Audience", "TeamPortal");
            b.UseSetting("Admin:Username", "boss");
            b.UseSetting("Admin:Password", "pw123456");
            // AiClient.ResolveAsync 的密钥/地址回落到配置（AiService:*）
            b.UseSetting("AiService:ApiKey", "sk-test");
            b.UseSetting("AiService:BaseUrl", "https://api.deepseek.com");
            // SystemAgentService 的 HttpClient 换成脚本化 handler（工具轮/最终流式都走它）
            b.ConfigureTestServices(s => s.AddHttpClient<SystemAgentService>()
                .ConfigurePrimaryHttpMessageHandler(() => handler));
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    public static async Task<string> LoginAsync(HttpClient client, string username, string password)
    {
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (await login.Content.ReadFromJsonAsync<LoginResp>())!.Token;
    }

    public static DbContextOptions<AppDbContext> Options(string dbPath)
        => new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=" + dbPath).Options;

    public static async Task SeedMemberAsync(string dbPath)
    {
        await using var db = new AppDbContext(Options(dbPath));
        db.Users.Add(new User
        {
            Username = "member1",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("pw123456"),
            Role = "member",
        });
        await db.SaveChangesAsync();
    }

    public static string ToolCall(string id, string name, string args)
        => JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content = "先查手册",
                        tool_calls = new[] { new { id, type = "function", function = new { name, arguments = args } } },
                    }
                }
            }
        });

    public static string Answer(string content = "直接回答")
        => JsonSerializer.Serialize(new { choices = new[] { new { message = new { content } } } });

    public static bool Has(string body, string property)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.TryGetProperty(property, out _);
    }

    public static bool IsStream(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("stream").GetBoolean();
    }

    /// <summary>每个用例独立目录：BackupService 的备份目录跟随 DB 所在目录，直接用 %TEMP% 会互相串数据。</summary>
    public static string NewDbPath()
    {
        var dir = Path.Combine(Path.GetTempPath(), "tp-agent-stream-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "teamportal.db");
    }

    public static void Cleanup(string dbPath)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        var dir = Path.GetDirectoryName(dbPath);
        try { if (dir is not null && Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
    }

    /// <summary>按脚本返回 OpenAI 兼容响应，同时记录每轮请求体。</summary>
    public sealed class ScriptedHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpResponseMessage>> _script = new();
        public List<string> Bodies { get; } = [];

        /// <summary>脚本用完后是否一律返回 500。用于"最终流式请求失败"的场景 ——
        /// 生产 HttpClient 挂了标准弹性管道（会对 5xx 自动重试），脚本耗尽后的兜底响应
        /// 必须继续失败，否则重试会拿到 200 SSE 把错误路径测没了。</summary>
        public bool FailAfterScript { get; set; }

        public void Enqueue(string body, string contentType = "application/json")
            => _script.Enqueue(() => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, contentType),
            });

        public void EnqueueStatus(HttpStatusCode status, string body)
            => _script.Enqueue(() => new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            if (_script.Count > 0) return _script.Dequeue()();
            if (FailAfterScript)
                return new HttpResponseMessage(HttpStatusCode.InternalServerError)
                {
                    Content = new StringContent("{\"error\":\"boom\"}", Encoding.UTF8, "application/json"),
                };
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(Sse, Encoding.UTF8, "text/event-stream"),
            };
        }
    }
}
