namespace TeamPortal.Data.Models;

public class CheckinRecord
{
    public int Id { get; set; }
    public int CheckoutRequestId { get; set; }
    public CheckoutRequest? CheckoutRequest { get; set; }
    public string Condition { get; set; } = "normal"; // normal | damaged
    public bool HasPhoto { get; set; }
    public string? TestNotes { get; set; }
    public string? PhotoUrl { get; set; }
    public int CheckedByUserId { get; set; }
    public User? CheckedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
