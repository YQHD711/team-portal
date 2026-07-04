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
    }
}
