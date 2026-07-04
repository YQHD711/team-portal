using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeamPortal.Data;
using TeamPortal.Endpoints;
using TeamPortal.Services;

var builder = WebApplication.CreateBuilder(args);

// Database
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

// JWT Auth
var jwtKey = builder.Configuration["Jwt:Key"]!;
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
builder.Services.AddAuthorization();

// CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

// Services
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<KnowledgeService>();
builder.Services.AddScoped<InventoryService>();
builder.Services.AddScoped<AdminService>();
builder.Services.AddHttpClient<AiProxyService>();
builder.Services.AddHttpClient<FlightLogService>();
builder.Services.AddHttpClient<DocumentService>();
builder.Services.AddScoped<WikiGeneratorService>();
builder.Services.AddScoped<SystemAgentService>();
builder.Services.AddHostedService<WikiProcessingWorker>();
builder.Services.AddSingleton<LogService>();
builder.Services.AddSingleton<NotificationService>();

builder.Services.AddOpenApi();

var app = builder.Build();

// Migrate & seed
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
    await auth.SeedAdmin();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

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
app.MapNotificationEndpoints();
app.MapSystemAgentEndpoints();

app.Run();
