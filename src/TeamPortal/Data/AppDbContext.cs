using Microsoft.EntityFrameworkCore;
using TeamPortal.Data.Models;

namespace TeamPortal.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<InventoryItem> InventoryItems => Set<InventoryItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Username).IsUnique();
            entity.Property(u => u.Username).IsRequired().HasMaxLength(50);
            entity.Property(u => u.Role).HasMaxLength(20);
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
