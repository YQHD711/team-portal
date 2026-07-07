using Microsoft.EntityFrameworkCore;
using TeamPortal.Data.Models;

namespace TeamPortal.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<InventoryItem> InventoryItems => Set<InventoryItem>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<WikiTask> WikiTasks => Set<WikiTask>();
    public DbSet<SharedFile> SharedFiles => Set<SharedFile>();
    public DbSet<SystemLog> SystemLogs => Set<SystemLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<CodeProposal> CodeProposals => Set<CodeProposal>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<InventoryTransaction> InventoryTransactions => Set<InventoryTransaction>();
    public DbSet<PilotProfile> PilotProfiles => Set<PilotProfile>();
    public DbSet<TrainingRecord> TrainingRecords => Set<TrainingRecord>();
    public DbSet<CompetitionRecord> CompetitionRecords => Set<CompetitionRecord>();
    public DbSet<FlightRecord> FlightRecords => Set<FlightRecord>();
    public DbSet<BatteryRecord> BatteryRecords => Set<BatteryRecord>();
    public DbSet<IncidentRecord> IncidentRecords => Set<IncidentRecord>();
    public DbSet<TrashItem> TrashItems => Set<TrashItem>();
    public DbSet<PurchaseRequest> PurchaseRequests => Set<PurchaseRequest>();
    public DbSet<InviteCode> InviteCodes => Set<InviteCode>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Username).IsUnique();
            entity.Property(u => u.Username).IsRequired().HasMaxLength(50);
            entity.Property(u => u.Role).HasMaxLength(20);
        });

        modelBuilder.Entity<User>()
            .HasOne(u => u.Department)
            .WithMany()
            .HasForeignKey(u => u.DepartmentId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<WikiTask>(entity =>
        {
            entity.Property(t => t.ProjectName).HasMaxLength(100);
            entity.Property(t => t.Status).HasMaxLength(20);
        });

        modelBuilder.Entity<Department>(entity =>
        {
            entity.Property(d => d.Name).IsRequired().HasMaxLength(50);
        });

        modelBuilder.Entity<InventoryItem>(entity =>
        {
            entity.Property(i => i.Name).IsRequired().HasMaxLength(100);
            entity.Property(i => i.Category).HasMaxLength(50);
            entity.Property(i => i.Location).HasMaxLength(100);
            entity.Property(i => i.Status).HasMaxLength(20);
        });

        modelBuilder.Entity<SystemSetting>(entity =>
        {
            entity.HasKey(s => s.Key);
            entity.Property(s => s.Value).HasMaxLength(2000);
            entity.Property(s => s.Category).HasMaxLength(50);
        });

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.HasIndex(c => c.SessionId);
            entity.HasIndex(c => new { c.UserName, c.CreatedAt });
            entity.Property(c => c.Content).HasMaxLength(10000);
            entity.Property(c => c.Role).HasMaxLength(20);
        });

        modelBuilder.Entity<InventoryTransaction>(entity =>
        {
            entity.HasIndex(t => t.InventoryItemId);
            entity.HasIndex(t => t.CreatedAt);
            entity.Property(t => t.Type).IsRequired().HasMaxLength(20);
            entity.Property(t => t.UserName).IsRequired().HasMaxLength(50);
            entity.HasOne(t => t.Item)
                .WithMany()
                .HasForeignKey(t => t.InventoryItemId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PilotProfile>(entity =>
        {
            entity.HasIndex(p => p.UserId).IsUnique();
            entity.Property(p => p.Level).HasMaxLength(20);
            entity.Property(p => p.EmergencyContact).HasMaxLength(50);
            entity.Property(p => p.EmergencyPhone).HasMaxLength(30);
            entity.HasOne(p => p.User)
                .WithMany()
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TrainingRecord>(entity =>
        {
            entity.HasIndex(t => t.UserId);
            entity.Property(t => t.CourseName).IsRequired().HasMaxLength(100);
            entity.Property(t => t.Examiner).HasMaxLength(50);
            entity.HasOne(t => t.User)
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CompetitionRecord>(entity =>
        {
            entity.HasIndex(c => c.UserId);
            entity.Property(c => c.CompetitionName).IsRequired().HasMaxLength(100);
            entity.Property(c => c.Event).HasMaxLength(50);
            entity.Property(c => c.Ranking).HasMaxLength(30);
            entity.HasOne(c => c.User)
                .WithMany()
                .HasForeignKey(c => c.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<FlightRecord>(entity =>
        {
            entity.HasIndex(f => f.PilotUserId);
            entity.HasIndex(f => f.TakeoffTime);
            entity.Property(f => f.AircraftModel).HasMaxLength(100);
            entity.Property(f => f.Location).HasMaxLength(100);
            entity.Property(f => f.Weather).HasMaxLength(50);
            entity.Property(f => f.BatteryNumber).HasMaxLength(50);
            entity.HasOne(f => f.Pilot)
                .WithMany()
                .HasForeignKey(f => f.PilotUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BatteryRecord>(entity =>
        {
            entity.HasIndex(b => b.BatteryNumber);
            entity.Property(b => b.BatteryNumber).IsRequired().HasMaxLength(50);
            entity.Property(b => b.Health).HasMaxLength(20);
        });

        modelBuilder.Entity<IncidentRecord>(entity =>
        {
            entity.HasIndex(i => i.Date);
            entity.Property(i => i.Type).HasMaxLength(30);
            entity.Property(i => i.Severity).HasMaxLength(20);
            entity.Property(i => i.Description).IsRequired();
            entity.Property(i => i.ReportedBy).HasMaxLength(50);
            entity.HasOne(i => i.RelatedFlight)
                .WithMany()
                .HasForeignKey(i => i.RelatedFlightId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<TrashItem>(entity =>
        {
            entity.HasIndex(t => t.DeletedAt);
            entity.Property(t => t.OriginalTable).IsRequired().HasMaxLength(50);
            entity.Property(t => t.Title).IsRequired().HasMaxLength(200);
            entity.Property(t => t.DeletedByName).HasMaxLength(50);
        });

        modelBuilder.Entity<InviteCode>(entity =>
        {
            entity.HasIndex(i => i.Code).IsUnique();
            entity.Property(i => i.Code).IsRequired().HasMaxLength(20);
        });

        modelBuilder.Entity<PurchaseRequest>(entity =>
        {
            entity.HasIndex(p => p.Status);
            entity.HasIndex(p => p.RequesterUserId);
            entity.Property(p => p.ItemName).IsRequired().HasMaxLength(200);
            entity.Property(p => p.Status).HasMaxLength(20);
            entity.Property(p => p.RejectReason).HasMaxLength(500);
            entity.HasOne(p => p.Requester)
                .WithMany()
                .HasForeignKey(p => p.RequesterUserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(p => p.Approver)
                .WithMany()
                .HasForeignKey(p => p.ApproverUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });
    }
}
