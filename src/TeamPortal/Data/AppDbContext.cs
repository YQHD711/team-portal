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
    public DbSet<OperationLog> OperationLogs => Set<OperationLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<CodeProposal> CodeProposals => Set<CodeProposal>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<InventoryTransaction> InventoryTransactions => Set<InventoryTransaction>();
    public DbSet<PilotProfile> PilotProfiles => Set<PilotProfile>();
    public DbSet<TrainingRecord> TrainingRecords => Set<TrainingRecord>();
    public DbSet<CompetitionRecord> CompetitionRecords => Set<CompetitionRecord>();
    public DbSet<BatteryRecord> BatteryRecords => Set<BatteryRecord>();
    public DbSet<IncidentRecord> IncidentRecords => Set<IncidentRecord>();
    public DbSet<TrashItem> TrashItems => Set<TrashItem>();
    public DbSet<PurchaseRequest> PurchaseRequests => Set<PurchaseRequest>();
    public DbSet<InviteCode> InviteCodes => Set<InviteCode>();
    public DbSet<CheckoutRequest> CheckoutRequests => Set<CheckoutRequest>();
    public DbSet<CheckinRecord> CheckinRecords => Set<CheckinRecord>();
    public DbSet<Stocktake> Stocktakes => Set<Stocktake>();
    public DbSet<StocktakeItem> StocktakeItems => Set<StocktakeItem>();
    public DbSet<DamageReport> DamageReports => Set<DamageReport>();
    public DbSet<StorageLayout> StorageLayouts => Set<StorageLayout>();
    public DbSet<SkillCertification> SkillCertifications => Set<SkillCertification>();
    public DbSet<DepartmentExam> DepartmentExams => Set<DepartmentExam>();
    public DbSet<DepartmentExamResult> DepartmentExamResults => Set<DepartmentExamResult>();

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
            entity.Property(i => i.LocationCode).HasMaxLength(50);
            entity.Property(i => i.Status).HasMaxLength(20);
            entity.Property(i => i.Grade).HasMaxLength(1);
            entity.Property(i => i.ProjectTag).HasMaxLength(100);
            entity.HasOne(i => i.Department)
                .WithMany()
                .HasForeignKey(i => i.DepartmentId)
                .OnDelete(DeleteBehavior.SetNull);
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

        modelBuilder.Entity<BatteryRecord>(entity =>
        {
            entity.HasIndex(b => b.BatteryNumber);
            entity.Property(b => b.BatteryNumber).IsRequired().HasMaxLength(50);
            entity.Property(b => b.Health).HasMaxLength(20);
            entity.Property(b => b.Notes).HasMaxLength(500);
        });

        modelBuilder.Entity<IncidentRecord>(entity =>
        {
            entity.HasIndex(i => i.Date);
            entity.Property(i => i.Type).HasMaxLength(30);
            entity.Property(i => i.Severity).HasMaxLength(20);
            entity.Property(i => i.Description).IsRequired();
            entity.Property(i => i.ReportedBy).HasMaxLength(50);
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

        modelBuilder.Entity<CheckoutRequest>(entity =>
        {
            entity.HasIndex(c => c.Status);
            entity.HasIndex(c => c.RequesterUserId);
            entity.Property(c => c.Grade).HasMaxLength(1);
            entity.Property(c => c.Status).HasMaxLength(20);
            entity.Property(c => c.Note).HasMaxLength(500);
            entity.Property(c => c.RejectReason).HasMaxLength(500);
            entity.HasOne(c => c.Item)
                .WithMany()
                .HasForeignKey(c => c.InventoryItemId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(c => c.Requester)
                .WithMany()
                .HasForeignKey(c => c.RequesterUserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(c => c.DeptApprover)
                .WithMany()
                .HasForeignKey(c => c.DeptApproverUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(c => c.AdminApprover)
                .WithMany()
                .HasForeignKey(c => c.AdminApproverUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<CheckinRecord>(entity =>
        {
            entity.HasIndex(c => c.CheckoutRequestId).IsUnique();
            entity.Property(c => c.Condition).HasMaxLength(20);
            entity.Property(c => c.TestNotes).HasMaxLength(1000);
            entity.HasOne(c => c.CheckoutRequest)
                .WithOne(c => c.Checkin)
                .HasForeignKey<CheckinRecord>(c => c.CheckoutRequestId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(c => c.CheckedBy)
                .WithMany()
                .HasForeignKey(c => c.CheckedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Stocktake>(entity =>
        {
            entity.HasIndex(s => s.Status);
            entity.Property(s => s.Type).HasMaxLength(20);
            entity.Property(s => s.Grade).HasMaxLength(1);
            entity.Property(s => s.Status).HasMaxLength(20);
            entity.HasOne(s => s.CreatedBy)
                .WithMany()
                .HasForeignKey(s => s.CreatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<StocktakeItem>(entity =>
        {
            entity.HasIndex(s => new { s.StocktakeId, s.InventoryItemId }).IsUnique();
            entity.Property(s => s.Note).HasMaxLength(500);
            entity.HasOne(s => s.Stocktake)
                .WithMany(s => s.Items)
                .HasForeignKey(s => s.StocktakeId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(s => s.InventoryItem)
                .WithMany()
                .HasForeignKey(s => s.InventoryItemId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(s => s.CheckedBy)
                .WithMany()
                .HasForeignKey(s => s.CheckedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DamageReport>(entity =>
        {
            entity.HasIndex(d => d.InventoryItemId);
            entity.Property(d => d.Type).HasMaxLength(20);
            entity.Property(d => d.Description).IsRequired();
            entity.Property(d => d.Liability).HasMaxLength(20);
            entity.Property(d => d.Resolution).HasMaxLength(1000);
            entity.HasOne(d => d.Item)
                .WithMany()
                .HasForeignKey(d => d.InventoryItemId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(d => d.User)
                .WithMany()
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<StorageLayout>(entity =>
        {
            entity.HasIndex(l => l.RoomCode).IsUnique();
            entity.Property(l => l.RoomCode).IsRequired().HasMaxLength(10);
            entity.Property(l => l.RoomName).IsRequired().HasMaxLength(50);
        });

        modelBuilder.Entity<OperationLog>(entity =>
        {
            entity.HasIndex(o => new { o.UserName, o.CreatedAt });
            entity.HasIndex(o => new { o.Action, o.CreatedAt });
            entity.Property(o => o.UserName).IsRequired().HasMaxLength(50);
            entity.Property(o => o.Action).IsRequired().HasMaxLength(50);
            entity.Property(o => o.TargetType).HasMaxLength(50);
            entity.Property(o => o.TargetId).HasMaxLength(200);
        });

        modelBuilder.Entity<SkillCertification>(entity =>
        {
            entity.HasIndex(s => s.UserId);
            entity.Property(s => s.CertName).IsRequired().HasMaxLength(100);
            entity.Property(s => s.Level).HasMaxLength(20);
            entity.Property(s => s.Status).HasMaxLength(20);
            entity.Property(s => s.Notes).HasMaxLength(500);
            entity.HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DepartmentExam>(entity =>
        {
            entity.HasIndex(e => e.DepartmentId);
            entity.Property(e => e.Title).IsRequired().HasMaxLength(100);
            entity.Property(e => e.ExamType).HasMaxLength(20);
            entity.Property(e => e.Status).HasMaxLength(20);
            entity.HasOne(e => e.Department)
                .WithMany()
                .HasForeignKey(e => e.DepartmentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DepartmentExamResult>(entity =>
        {
            entity.HasIndex(r => new { r.ExamId, r.UserId }).IsUnique();
            entity.Property(r => r.Notes).HasMaxLength(500);
            entity.HasOne(r => r.Exam)
                .WithMany()
                .HasForeignKey(r => r.ExamId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(r => r.User)
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
