namespace TeamPortal.Data.Models;

public class CheckoutRequest
{
    public int Id { get; set; }
    public int InventoryItemId { get; set; }
    public InventoryItem? Item { get; set; }
    public int RequesterUserId { get; set; }
    public User? Requester { get; set; }
    public int Quantity { get; set; }
    public string Grade { get; set; } = "C";
    public string Status { get; set; } = "pending_dept";
    // pending_dept → pending_admin → approved → rejected | returned
    public int? DeptApproverUserId { get; set; }
    public User? DeptApprover { get; set; }
    public int? AdminApproverUserId { get; set; }
    public User? AdminApprover { get; set; }
    public string? Note { get; set; }
    public string? RejectReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAt { get; set; }
    public DateTime? ReturnedAt { get; set; }

    public CheckinRecord? Checkin { get; set; }
}
