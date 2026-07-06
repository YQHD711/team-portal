using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using TeamPortal.Endpoints;
using TeamPortal.Middleware;
using TeamPortal.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Validate required secrets ──
var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrEmpty(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:Key 未配置或长度不足32字符，请在环境变量 JWT__KEY 中设置");

var adminUser = builder.Configuration["Admin:Username"];
var adminPwd = builder.Configuration["Admin:Password"];
if (string.IsNullOrEmpty(adminUser)) builder.Configuration["Admin:Username"] = "admin";
if (string.IsNullOrEmpty(adminPwd)) builder.Configuration["Admin:Password"] = Guid.NewGuid().ToString("N")[..12];

// ── Database ──
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

// ── JWT Auth ──
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        };
    });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", p => p.RequireRole("admin"));
    options.AddPolicy("StaffOnly", p => p.RequireRole("admin", "部长"));
});

// ── CORS (restrict in production) ──
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

// ── ProblemDetails for consistent error responses ──
builder.Services.AddProblemDetails();

// ── Services ──
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<KnowledgeService>();
builder.Services.AddScoped<InventoryService>();
builder.Services.AddScoped<AdminService>();
builder.Services.AddHttpClient<AiProxyService>();
builder.Services.AddHttpClient<FlightLogService>();
builder.Services.AddHttpClient<DocumentService>();
builder.Services.AddScoped<WikiGeneratorService>();
builder.Services.AddScoped<SystemAgentService>();
builder.Services.AddScoped<BaiduNetdiskService>();
builder.Services.AddHostedService<WikiProcessingWorker>();
builder.Services.AddHostedService<MaintenanceWorker>();
builder.Services.AddSingleton<LogService>();
builder.Services.AddSingleton<NotificationService>();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<ConversationService>();
builder.Services.AddSingleton<MaintenanceService>();

builder.Services.AddOpenApi();

var app = builder.Build();

// ── Migrate & seed ──
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();

    // ── Auto-migrate: add missing columns on existing tables ──
    // EnsureCreated() only creates new tables; it does NOT alter existing ones.
    // When models gain new fields after initial creation, we must add columns manually.
    MigrateExistingTables(db);

    var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
    var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
    await auth.SeedAdmin();
    await settings.SeedDefaults();

    // Seed default departments if empty
    if (!db.Departments.Any())
    {
        db.Departments.AddRange(
            new Department { Name = "飞训部", Description = "飞行训练、飞行员培训、飞行任务执行" },
            new Department { Name = "电子部", Description = "飞控系统、电子设备、传感器、电路设计与维护" },
            new Department { Name = "工程部", Description = "机体结构设计、制造、装配、维修" },
            new Department { Name = "办公室", Description = "行政管理、文档管理、会议组织、对外联络" },
            new Department { Name = "集群部", Description = "编队飞行、集群算法、多机协同技术" },
            new Department { Name = "文创部", Description = "宣传物料、视觉设计、文化创意、媒体运营" }
        );
        db.SaveChanges();
    }
}

// ── Middleware pipeline ──
app.UseTeamPortalExceptionHandler();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
else
{
    app.MapOpenApi();
}

app.UseStatusCodePages();
app.UseCors();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Ok(new { status = "ok", service = "TeamPortal API" }));
app.MapAuthEndpoints();
app.MapKnowledgeEndpoints();
app.MapInventoryEndpoints();
app.MapAiEndpoints();
app.MapFlightLogEndpoints();
app.MapAdminEndpoints();
app.MapLogEndpoints();
app.MapWikiEndpoints();
app.MapBaiduEndpoints();
app.MapNotificationEndpoints();
app.MapSystemAgentEndpoints();
app.MapSettingsEndpoints();
app.MapChatEndpoints();
app.MapMaintenanceEndpoints();

app.Run();

// ── Schema migration helper ──
// Uses raw ADO.NET to avoid coupling to evolving EF Core SQL execution APIs.
static void MigrateExistingTables(AppDbContext db)
{
    var conn = db.Database.GetDbConnection();
    try
    {
        if (conn.State != System.Data.ConnectionState.Open)
            conn.Open();

        // Notification.UserId — added after initial table creation
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "ALTER TABLE Notifications ADD COLUMN UserId INTEGER NULL";
        cmd.ExecuteNonQuery();
    }
    catch
    {
        // Column already exists — this is expected on subsequent startups
    }
}
