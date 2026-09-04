namespace TeamPortal.Data.Models;

public class PurchaseRequest
{
    public int Id { get; set; }
    public int RequesterUserId { get; set; }
    public User? Requester { get; set; }
    public string ItemName { get; set; } = string.Empty;
    public int Quantity { get; set; } = 1;
    public decimal EstimatedPrice { get; set; }
    public decimal? ActualPrice { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    // pending → approved → purchased → received
    // pending → rejected
    public int? ApproverUserId { get; set; }
    public User? Approver { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? PurchasedAt { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public string? RejectReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
