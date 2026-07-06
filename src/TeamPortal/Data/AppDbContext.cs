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
    public DbSet<SystemLog> SystemLogs => Set<SystemLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<CodeProposal> CodeProposals => Set<CodeProposal>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<InventoryTransaction> InventoryTransactions => Set<InventoryTransaction>();

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
    }
}
