using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.IdentityModel.Tokens;
using TeamPortal.Data;
using TeamPortal.Data.Models;
using ModelContextProtocol.AspNetCore;
using TeamPortal.Endpoints;
using TeamPortal.Middleware;
using TeamPortal.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Validate required secrets ──
// Jwt:Key 优先来自环境变量 JWT__KEY(生产必须配置);开发环境缺失时运行时生成随机密钥,
// 不再使用任何硬编码可猜字符串。随机密钥重启后失效(已签发 token 全部作废),见启动 WARN 日志。
var jwtKey = builder.Configuration["Jwt:Key"];
var jwtKeyGenerated = false;
if (string.IsNullOrEmpty(jwtKey))
{
    jwtKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    jwtKeyGenerated = true;
    // 写回配置:AuthService 等后续通过 IConfiguration 读 Jwt:Key 的地方必须拿到同一密钥
    builder.Configuration["Jwt:Key"] = jwtKey;
}
else if (jwtKey.Length < 32)
{
    throw new InvalidOperationException("Jwt:Key 长度不足32字符，请在环境变量 JWT__KEY 中设置");
}

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
var corsOrigins = (builder.Configuration["Cors:Origins"] ?? "http://localhost:3000")
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsOrigins)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

// ── JSON: explicit camelCase + forced UTC DateTime serialization ──
builder.Services.ConfigureHttpJsonOptions(opts =>
{
    opts.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    opts.SerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    opts.SerializerOptions.Converters.Add(new TeamPortal.Json.UtcDateTimeConverter());
});

// ── ProblemDetails for consistent error responses ──
builder.Services.AddProblemDetails();

// ── HTTP Resilience (Polly: retry + circuit breaker + timeout) ──
builder.Services.ConfigureHttpClientDefaults(options =>
{
    options.AddStandardResilienceHandler();
});

// ── Graceful shutdown ──
builder.Services.Configure<HostOptions>(options =>
{
    options.ShutdownTimeout = TimeSpan.FromSeconds(15);
});

// ── Health checks (DB + AI Service) ──
builder.Services.AddHealthChecks()
    .AddCheck<DbHealthCheck>("database", failureStatus: HealthStatus.Unhealthy)
    .AddCheck<AiServiceHealthCheck>("ai-service", failureStatus: HealthStatus.Degraded);

// ── Rate limiting ──
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("default", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromSeconds(10),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 10
            }));
    options.AddPolicy("login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromSeconds(60),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            }));
});

// ── Services ──
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<KnowledgeService>();
builder.Services.AddHttpClient<InventoryService>();
builder.Services.AddScoped<AdminService>();
builder.Services.AddHttpClient<AiProxyService>();
builder.Services.AddHttpClient<FlightLogService>();
builder.Services.AddHttpClient<DocumentService>();
builder.Services.AddSingleton<KnowledgeSearchService>();
builder.Services.AddHttpClient<WikiGeneratorService>();
builder.Services.AddHttpClient<SystemAgentService>();
builder.Services.AddScoped<BaiduNetdiskService>();
builder.Services.AddScoped<ProfileService>();
builder.Services.AddScoped<CertificationService>();
builder.Services.AddScoped<ExamService>();
builder.Services.AddScoped<FlightService>();
builder.Services.AddScoped<TrashService>();
builder.Services.AddScoped<FinanceService>();
builder.Services.AddScoped<MaterialService>();
builder.Services.AddSingleton<BackupService>();
builder.Services.AddHostedService<WikiProcessingWorker>();
builder.Services.AddHostedService<MaintenanceWorker>();
builder.Services.AddSingleton<LogService>();
builder.Services.AddSingleton<NotificationService>();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<ConversationService>();
builder.Services.AddSingleton<MaintenanceService>();

// ── MCP Server for external AI agents ──
builder.Services.AddHttpContextAccessor();
builder.Services.AddMcpServer()
    .WithToolsFromAssembly()
    .WithHttpTransport(options => options.Stateless = true);

builder.Services.AddOpenApi();

var app = builder.Build();

if (jwtKeyGenerated)
    app.Logger.LogWarning("未配置 JWT__KEY,已生成随机密钥。重启后所有已签发 token 失效;生产环境必须设置环境变量 JWT__KEY(≥32字符)。");

// ── Auto-recovery: check DB health before migration ──
using (var scope = app.Services.CreateScope())
{
    var backup = scope.ServiceProvider.GetRequiredService<BackupService>();
    var log = scope.ServiceProvider.GetRequiredService<LogService>();
    var recoveryResult = backup.CheckAndRecoverOnStartup();
    if (recoveryResult.Recovered)
        log.Warn("system", recoveryResult.Message);
    else
        log.Info("system", recoveryResult.Message);
}

// ── Migrate & seed ──
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate(); // EF Core Migrations：全新库由 InitialCreate 建全 29 表

    // ── 兼容历史库的幂等迁移(手写 ALTER/CREATE,逐步淘汰) ──
    // 2026-08 从 EnsureCreated 切换到 EF Migrations。历史库(无 __EFMigrationsHistory 表)
    // 需先执行 deploy/ef-baseline.sql 标记 InitialCreate 已应用,否则上方 Migrate() 会因
    // 表已存在而失败。baseline 后历史库跳过 InitialCreate,由下方幂等语句兜底补齐列/表;
    // 全新库由 InitialCreate 建表后,下方语句因 IF NOT EXISTS / duplicate column 容错全部跳过。
    // 后续 schema 变更应新增 EF 迁移,不再向本函数添加语句。
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

    // Seed default storage room layouts if empty (B2冯如楼)
    if (!db.StorageLayouts.Any())
    {
        db.StorageLayouts.AddRange(
            new StorageLayout { RoomCode = "1030", RoomName = "库房", Floor = 1, CabinetCount = 4, ShelfCount = 4, PositionCount = 8, Description = "航模器材库房" },
            new StorageLayout { RoomCode = "1011", RoomName = "展厅", Floor = 1, CabinetCount = 4, ShelfCount = 4, PositionCount = 8, Description = "作品展示与参观" },
            new StorageLayout { RoomCode = "1012", RoomName = "机械制造加工", Floor = 1, CabinetCount = 4, ShelfCount = 4, PositionCount = 8, Description = "机械加工与制造" },
            new StorageLayout { RoomCode = "6010", RoomName = "会议室", Floor = 6, CabinetCount = 4, ShelfCount = 4, PositionCount = 8, Description = "会议与办公" },
            new StorageLayout { RoomCode = "6011", RoomName = "电子电路/无人机试飞", Floor = 6, CabinetCount = 4, ShelfCount = 4, PositionCount = 8, Description = "电子电路与无人机试飞" },
            new StorageLayout { RoomCode = "6012", RoomName = "办公室", Floor = 6, CabinetCount = 4, ShelfCount = 4, PositionCount = 8, Description = "日常办公" }
        );
        db.SaveChanges();
    }

    // 平面图模式：为尚无 LayoutJson 的房间（含旧数据）回填默认平面图（四周墙 + 居中 1 个货架）
    var layoutBackfilled = false;
    foreach (var l in db.StorageLayouts.Where(l => l.LayoutJson == null))
    {
        l.LayoutJson = DefaultRoomLayoutJson(l.RoomCode);
        layoutBackfilled = true;
    }
    if (layoutBackfilled) db.SaveChanges();
}

// ── Middleware pipeline ──
app.UseTeamPortalExceptionHandler();
app.UseRequestLogging();

// Forwarded Headers：只信任显式配置的代理网段，默认不信任任何代理（直接模式）。
// 未配置时忽略所有 X-Forwarded-* 头，防止攻击者伪造 X-Forwarded-For 绕过
// 基于 RemoteIpAddress 的限流/审计。部署在 nginx/docker 之后时配置环境变量，如：
//   ForwardedHeaders__KnownNetworks=172.16.0.0/12;127.0.0.1
// 格式：分号分隔的 CIDR 或单 IP；KnownProxies 为分号分隔的单 IP（可选）。
var knownNetworksCfg = builder.Configuration["ForwardedHeaders:KnownNetworks"];
var knownProxiesCfg = builder.Configuration["ForwardedHeaders:KnownProxies"];
var useForwardedHeaders = !string.IsNullOrWhiteSpace(knownNetworksCfg) || !string.IsNullOrWhiteSpace(knownProxiesCfg);
if (useForwardedHeaders)
{
    // 配置了可信代理网段时才处理 X-Forwarded-* 头（部署在 nginx/docker 之后时设置，如：
    //   ForwardedHeaders__KnownNetworks=172.16.0.0/12;127.0.0.1
    // 格式：分号分隔的 CIDR 或单 IP；KnownProxies 为分号分隔的单 IP（可选）。）
    // 注意：KnownProxies 与 KnownIPNetworks 为空时中间件会信任所有代理（伪造 XFF 可绕过
    // 基于 RemoteIpAddress 的限流），因此未配置时绝不注册该中间件。
    var fho = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
    };
    foreach (var entry in (knownNetworksCfg ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
        var parts = entry.Split('/');
        if (parts.Length == 2 && IPAddress.TryParse(parts[0], out var ip) && int.TryParse(parts[1], out var prefix))
            fho.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(ip, prefix));
        else if (IPAddress.TryParse(entry, out var single))
            fho.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(
                single, single.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? 128 : 32));
    }
    foreach (var proxy in (knownProxiesCfg ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
        if (IPAddress.TryParse(proxy, out var pip)) fho.KnownProxies.Add(pip);
    }
    app.UseForwardedHeaders(fho);
}

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
else
{
    app.MapOpenApi();
}

app.UseStatusCodePages();
app.UseRateLimiter();
app.UseCors();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

// ── WebTools 静态站：直接托管 G:\ardupilot_log_analysis\WebTools 目录（自定义中间件）。
//    相比反向代理（:8123）：路径天然正确，无 Next rewrite 尾斜杠循环；
//    无尾斜杠目录请求直接返回 index.html（不发 301，避免 iframe 跳成跨源）；
//    HTML 相对资源路径改写为 /webtools/... 绝对路径；iframe 与主站同源，File System Access API 可用。
//    前端守卫已拦未登录，故此处无需额外鉴权。
app.UseWebToolsStatic();

app.MapGet("/", () => Results.Ok(new { status = "ok", service = "TeamPortal API" }));
app.MapHealthChecks("/health");
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
app.MapFileEndpoints();
app.MapSystemAgentEndpoints();
app.MapSettingsEndpoints();
app.MapChatEndpoints();
app.MapMaintenanceEndpoints();
app.MapProfileEndpoints();
app.MapCertificationEndpoints();
app.MapExamEndpoints();
app.MapFlightEndpoints();
app.MapSearchEndpoints();
app.MapTrashEndpoints();
app.MapFinanceEndpoints();
app.MapMaterialEndpoints();
app.MapDashboardEndpoints();
app.MapStorageEndpoints();
app.MapBackupEndpoints();
app.MapMcp("/mcp").RequireAuthorization();

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
        MigrateSql(conn, "ALTER TABLE Notifications ADD COLUMN UserId INTEGER NULL",
            "duplicate column");

        // PilotProfiles.FlightTypes — added after initial table creation
        MigrateSql(conn, "ALTER TABLE PilotProfiles ADD COLUMN FlightTypes TEXT",
            "duplicate column");

        // PilotProfiles.Skills — 技能标签(逗号分隔),组织架构/队员档案卡片展示
        MigrateSql(conn, "ALTER TABLE PilotProfiles ADD COLUMN Skills TEXT",
            "duplicate column");

        // BatteryRecords.IncidentDate — replaces CycleCount/CapacityMAh/LastUsedDate
        MigrateSql(conn, "ALTER TABLE BatteryRecords ADD COLUMN IncidentDate TEXT DEFAULT (datetime('now'))",
            "duplicate column");

        // Notifications.TargetRole — role-based notification filtering
        MigrateSql(conn, "ALTER TABLE Notifications ADD COLUMN TargetRole TEXT NULL",
            "duplicate column");

        // ── New tables (Phase 10+: profiles, flights, batteries, incidents, trash) ──
        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS PilotProfiles (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL UNIQUE,
                Level TEXT DEFAULT '学员',
                TotalFlightHours REAL DEFAULT 0,
                FirstFlightDate TEXT,
                Bio TEXT,
                EmergencyContact TEXT,
                EmergencyPhone TEXT,
                UpdatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS TrainingRecords (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL,
                CourseName TEXT NOT NULL,
                Score REAL,
                ExamDate TEXT DEFAULT (datetime('now')),
                Examiner TEXT,
                Notes TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS CompetitionRecords (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL,
                CompetitionName TEXT NOT NULL,
                Date TEXT DEFAULT (datetime('now')),
                Event TEXT,
                Ranking TEXT,
                Certificate TEXT,
                Notes TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS BatteryRecords (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                BatteryNumber TEXT NOT NULL,
                Health TEXT DEFAULT '正常',
                IncidentDate TEXT DEFAULT (datetime('now')),
                Notes TEXT,
                CreatedAt TEXT DEFAULT (datetime('now'))
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS IncidentRecords (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Type TEXT DEFAULT '设备故障',
                Severity TEXT DEFAULT '一般',
                Description TEXT NOT NULL,
                Date TEXT DEFAULT (datetime('now')),
                Resolution TEXT,
                ReportedBy TEXT,
                CreatedAt TEXT DEFAULT (datetime('now'))
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS InviteCodes (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Code TEXT NOT NULL UNIQUE,
                DepartmentId INTEGER,
                MaxUses INTEGER DEFAULT 1,
                UsedCount INTEGER DEFAULT 0,
                CreatedByUserId INTEGER NOT NULL,
                IsRevoked INTEGER DEFAULT 0,
                ExpiresAt TEXT DEFAULT (datetime('now','+7 days')),
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (DepartmentId) REFERENCES Departments(Id) ON DELETE SET NULL
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS PurchaseRequests (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                RequesterUserId INTEGER NOT NULL,
                ItemName TEXT NOT NULL,
                Quantity INTEGER DEFAULT 1,
                EstimatedPrice REAL DEFAULT 0,
                ActualPrice REAL,
                Reason TEXT DEFAULT '',
                Status TEXT DEFAULT 'pending',
                ApproverUserId INTEGER,
                ApprovedAt TEXT,
                PurchasedAt TEXT,
                ReceivedAt TEXT,
                RejectReason TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (RequesterUserId) REFERENCES Users(Id) ON DELETE CASCADE,
                FOREIGN KEY (ApproverUserId) REFERENCES Users(Id) ON DELETE SET NULL
            )
        """);

        // InventoryItem new columns (Phase: material grading)
        MigrateSql(conn, "ALTER TABLE InventoryItems ADD COLUMN Grade TEXT DEFAULT 'C'",
            "duplicate column");
        MigrateSql(conn, "ALTER TABLE InventoryItems ADD COLUMN UnitPrice REAL DEFAULT 0",
            "duplicate column");
        MigrateSql(conn, "ALTER TABLE InventoryItems ADD COLUMN DepartmentId INTEGER NULL REFERENCES Departments(Id) ON DELETE SET NULL",
            "duplicate column");
        MigrateSql(conn, "ALTER TABLE InventoryItems ADD COLUMN ProjectTag TEXT",
            "duplicate column");
        MigrateSql(conn, "ALTER TABLE InventoryItems ADD COLUMN LocationCode TEXT",
            "duplicate column");
        // SQLite forbids ADD COLUMN with a non-constant default — add bare column, then backfill
        MigrateSql(conn, "ALTER TABLE InventoryItems ADD COLUMN CreatedAt TEXT",
            "duplicate column");
        MigrateSql(conn, "UPDATE InventoryItems SET CreatedAt = UpdatedAt WHERE CreatedAt IS NULL",
            "no such column"); // harmless on re-run: column already filled
        // Old Location column was NOT NULL but model dropped it — make nullable
        MakeColumnNullable(conn, "InventoryItems", "Location");

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS TrashItems (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                OriginalTable TEXT NOT NULL,
                OriginalId INTEGER NOT NULL,
                Title TEXT NOT NULL,
                DataJson TEXT DEFAULT '{}',
                DeletedByUserId INTEGER NOT NULL,
                DeletedByName TEXT,
                DeletedAt TEXT DEFAULT (datetime('now'))
            )
        """);

        // ── Material grading: new tables ──
        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS CheckoutRequests (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                InventoryItemId INTEGER NOT NULL,
                RequesterUserId INTEGER NOT NULL,
                Quantity INTEGER NOT NULL,
                Grade TEXT NOT NULL DEFAULT 'C',
                Status TEXT NOT NULL DEFAULT 'pending_dept',
                DeptApproverUserId INTEGER,
                AdminApproverUserId INTEGER,
                Note TEXT,
                RejectReason TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                ApprovedAt TEXT,
                ReturnedAt TEXT,
                FOREIGN KEY (InventoryItemId) REFERENCES InventoryItems(Id) ON DELETE CASCADE,
                FOREIGN KEY (RequesterUserId) REFERENCES Users(Id) ON DELETE CASCADE,
                FOREIGN KEY (DeptApproverUserId) REFERENCES Users(Id) ON DELETE SET NULL,
                FOREIGN KEY (AdminApproverUserId) REFERENCES Users(Id) ON DELETE SET NULL
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS CheckinRecords (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                CheckoutRequestId INTEGER NOT NULL UNIQUE,
                Condition TEXT NOT NULL DEFAULT 'normal',
                HasPhoto INTEGER NOT NULL DEFAULT 0,
                TestNotes TEXT,
                PhotoUrl TEXT,
                CheckedByUserId INTEGER NOT NULL,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (CheckoutRequestId) REFERENCES CheckoutRequests(Id) ON DELETE CASCADE,
                FOREIGN KEY (CheckedByUserId) REFERENCES Users(Id) ON DELETE SET NULL
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS Stocktakes (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Type TEXT NOT NULL DEFAULT 'weekly',
                Grade TEXT NOT NULL DEFAULT 'A',
                Status TEXT NOT NULL DEFAULT 'in_progress',
                StartedAt TEXT DEFAULT (datetime('now')),
                CompletedAt TEXT,
                CreatedByUserId INTEGER NOT NULL,
                FOREIGN KEY (CreatedByUserId) REFERENCES Users(Id) ON DELETE SET NULL
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS StocktakeItems (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                StocktakeId INTEGER NOT NULL,
                InventoryItemId INTEGER NOT NULL,
                SystemQty INTEGER NOT NULL DEFAULT 0,
                ActualQty INTEGER,
                Difference INTEGER,
                Note TEXT,
                CheckedByUserId INTEGER,
                FOREIGN KEY (StocktakeId) REFERENCES Stocktakes(Id) ON DELETE CASCADE,
                FOREIGN KEY (InventoryItemId) REFERENCES InventoryItems(Id) ON DELETE CASCADE,
                FOREIGN KEY (CheckedByUserId) REFERENCES Users(Id) ON DELETE SET NULL
            )
        """);

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS DamageReports (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                InventoryItemId INTEGER NOT NULL,
                UserId INTEGER NOT NULL,
                Type TEXT NOT NULL DEFAULT 'damage',
                Description TEXT NOT NULL,
                IsApprovedTest INTEGER NOT NULL DEFAULT 0,
                Liability TEXT NOT NULL DEFAULT 'pending',
                CompensationAmount REAL,
                Resolution TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (InventoryItemId) REFERENCES InventoryItems(Id) ON DELETE CASCADE,
                FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
            )
        """);

        // ── Room storage layouts (Phase: storage visualization) ──
        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS StorageLayouts (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                RoomCode TEXT NOT NULL UNIQUE,
                RoomName TEXT NOT NULL,
                Floor INTEGER NOT NULL,
                CabinetCount INTEGER NOT NULL DEFAULT 4,
                ShelfCount INTEGER NOT NULL DEFAULT 4,
                PositionCount INTEGER NOT NULL DEFAULT 8,
                Description TEXT,
                UpdatedAt TEXT DEFAULT (datetime('now'))
            )
        """);

        // StorageLayouts.LayoutJson — 平面图 JSON（可视化编辑器），空则回退旧网格模式
        MigrateSql(conn, "ALTER TABLE StorageLayouts ADD COLUMN LayoutJson TEXT",
            "duplicate column");

        // ── OperationLogs(操作审计日志,与 SystemLogs 分离)— 全新表,EnsureCreated 对已有库不会创建,需手动建
        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS OperationLogs (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER,
                UserName TEXT NOT NULL,
                Action TEXT NOT NULL,
                TargetType TEXT,
                TargetId TEXT,
                Data TEXT,
                IpAddress TEXT,
                CreatedAt TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """);
        MigrateSql(conn, "CREATE INDEX IF NOT EXISTS IX_OperationLogs_UserName_CreatedAt ON OperationLogs (UserName, CreatedAt)");
        MigrateSql(conn, "CREATE INDEX IF NOT EXISTS IX_OperationLogs_Action_CreatedAt ON OperationLogs (Action, CreatedAt)");

        // ── 组织考核认证:个人技能认证 + 部门考核(组织架构改造新增)— 全新表,EnsureCreated 对已有库不生效
        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS SkillCertifications (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL,
                CertName TEXT NOT NULL,
                Level TEXT DEFAULT '',
                Status TEXT DEFAULT 'pending',
                CertDate TEXT,
                Notes TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
            )
        """);
        MigrateSql(conn, "CREATE INDEX IF NOT EXISTS IX_SkillCertifications_UserId ON SkillCertifications (UserId)");

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS DepartmentExams (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                DepartmentId INTEGER NOT NULL,
                Title TEXT NOT NULL,
                ExamType TEXT DEFAULT 'theory',
                Status TEXT DEFAULT 'ongoing',
                ExamDate TEXT,
                CreatedByUserId INTEGER NOT NULL,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (DepartmentId) REFERENCES Departments(Id) ON DELETE CASCADE
            )
        """);
        MigrateSql(conn, "CREATE INDEX IF NOT EXISTS IX_DepartmentExams_DepartmentId ON DepartmentExams (DepartmentId)");

        MigrateSql(conn, """
            CREATE TABLE IF NOT EXISTS DepartmentExamResults (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ExamId INTEGER NOT NULL,
                UserId INTEGER NOT NULL,
                Passed INTEGER NOT NULL DEFAULT 0,
                Score REAL,
                Notes TEXT,
                CreatedAt TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (ExamId) REFERENCES DepartmentExams(Id) ON DELETE CASCADE,
                FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
                UNIQUE (ExamId, UserId)
            )
        """);
        MigrateSql(conn, "CREATE INDEX IF NOT EXISTS IX_DepartmentExamResults_ExamId ON DepartmentExamResults (ExamId)");
    }
    catch (Exception ex)
    {
        // Keep startup alive but surface the failure — will retry on next start
        Console.WriteLine($"[WARN] DB migration failed, will retry on next start: {ex}");
    }
}

static void MigrateSql(System.Data.Common.DbConnection conn, string sql, string? ignoreMsg = null)
{
    try
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
    catch (Microsoft.Data.Sqlite.SqliteException ex) when (ignoreMsg is not null && ex.Message.Contains(ignoreMsg))
    {
        // Expected on subsequent runs
    }
}

/// <summary>Make a column nullable. SQLite can't ALTER COLUMN, so recreates the table.</summary>
static void MakeColumnNullable(System.Data.Common.DbConnection conn, string table, string column)
{
    try
    {
        using var info = conn.CreateCommand();
        info.CommandText = $"PRAGMA table_info(\"{table}\")";
        using var r = info.ExecuteReader();
        while (r.Read())
        {
            if (r.GetString(1) == column && !r.IsDBNull(3) && r.GetBoolean(3)) // notnull == 1 → needs fix
            {
                r.Close();
                var temp = $"\"{table}_migrate\"";
                var ddl = GetCreateSql(conn, table);
                var newDdl = ddl.Replace($"\"{column}\" TEXT NOT NULL", $"\"{column}\" TEXT NULL")
                                .Replace($"\"{column}\" INTEGER NOT NULL", $"\"{column}\" INTEGER NULL")
                                .Replace($"\"{column}\" REAL NOT NULL", $"\"{column}\" REAL NULL")
                                .Replace($"\"{column}\" BLOB NOT NULL", $"\"{column}\" BLOB NULL");
                if (newDdl == ddl) return; // no change needed
                using var tx = conn.BeginTransaction();
                try
                {
                    using var cmd = conn.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = $"CREATE TABLE {temp} {newDdl[(newDdl.IndexOf('('))..]}";
                    cmd.ExecuteNonQuery();
                    cmd.CommandText = $"INSERT INTO {temp} SELECT * FROM \"{table}\"";
                    cmd.ExecuteNonQuery();
                    cmd.CommandText = $"DROP TABLE \"{table}\"";
                    cmd.ExecuteNonQuery();
                    cmd.CommandText = $"ALTER TABLE {temp} RENAME TO \"{table}\"";
                    cmd.ExecuteNonQuery();
                    tx.Commit();
                    Console.WriteLine($"[MIGRATE] Made {table}.{column} nullable");
                }
                catch { tx.Rollback(); throw; }
                return;
            }
        }
    }
    catch (Exception ex) when (ex.Message.Contains("duplicate") || ex.Message.Contains("already exists"))
    {
        // Expected on re-run
    }
}

static string GetCreateSql(System.Data.Common.DbConnection conn, string table)
{
    using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT sql FROM sqlite_master WHERE name='{table}' AND type='table'";
    return (string?)cmd.ExecuteScalar() ?? "";
}

/// <summary>默认平面图：900×600 画布，四周墙 + 居中一个货架占位（locCode 随房间号）</summary>
static string DefaultRoomLayoutJson(string roomCode) => $$"""
    {
      "width": 900, "height": 600,
      "walls": [
        { "id": "w1", "x": 20, "y": 20, "w": 860, "h": 10, "rotation": 0 },
        { "id": "w2", "x": 20, "y": 570, "w": 860, "h": 10, "rotation": 0 },
        { "id": "w3", "x": 20, "y": 20, "w": 10, "h": 560, "rotation": 0 },
        { "id": "w4", "x": 870, "y": 20, "w": 10, "h": 560, "rotation": 0 }
      ],
      "doors": [], "windows": [],
      "items": [
        { "id": "it1", "type": "shelf", "name": "A货架", "x": 330, "y": 240, "w": 240, "h": 120, "rotation": 0, "locCode": "{{roomCode}}-A", "shelfCount": 4, "positionCount": 8 }
      ]
    }
    """;
