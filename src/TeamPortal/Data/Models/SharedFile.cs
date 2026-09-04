namespace TeamPortal.Data.Models;

public class SharedFile
{
    public int Id { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string OriginalName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long Size { get; set; }
    public string Visibility { get; set; } = "public"; // public | department
    public string? Department { get; set; }
    public int UploaderId { get; set; }
    public string UploaderName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
