namespace TeamPortal.Data.Models;

public class SystemSetting
{
    /// <summary>Config key (e.g. "Auth:JwtExpireDays")</summary>
    public string Key { get; set; } = "";

    /// <summary>Value as string — parsed by consumer</summary>
    public string Value { get; set; } = "";

    /// <summary>Category for UI grouping</summary>
    public string Category { get; set; } = "";

    /// <summary>Human-readable description</summary>
    public string Description { get; set; } = "";

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
