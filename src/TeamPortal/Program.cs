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
app.UseRequestLogging();

// Forwarded Headers：信任来自 nginx 反向代理的 X-Forwarded-* 头
// Docker 内部网络中所有流量来自可信代理
var fho = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
};
fho.KnownProxies.Clear();
fho.KnownIPNetworks.Clear();
app.UseForwardedHeaders(fho);

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
app.MapFlightEndpoints();
app.MapSearchEndpoints();
app.MapTrashEndpoints();
app.MapFinanceEndpoints();
app.MapMaterialEndpoints();
app.MapDashboardEndpoints();
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
