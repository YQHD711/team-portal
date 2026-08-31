using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TeamPortal.Data.Models;

namespace TeamPortal.Services;

/// <summary>
/// SystemAgentService 的提案管理部分：创建代码改进提案、查询待审批提案（AI 写操作需管理员审批）。
/// </summary>
public partial class SystemAgentService
{
    private string CreateProposal(JsonElement r, string user)
    {
        var proposal = new CodeProposal
        {
            Title = r.GetProperty("title").GetString()!,
            Description = r.GetProperty("description").GetString()!,
            FilePath = r.GetProperty("filePath").GetString()!,
            SuggestedCode = r.GetProperty("suggestedCode").GetString()!,
            CreatedBy = user
        };
        _db.CodeProposals.Add(proposal);
        _db.SaveChanges();
        _log.Info("admin", $"AI proposal created: {proposal.Title}");
        return $"{{\"success\": true, \"id\": \"{proposal.Id}\", \"message\": \"提案已创建，等待管理员审批\"}}";
    }

    private async Task<string> ListProposals()
    {
        var proposals = await _db.CodeProposals.Where(p => p.Status == "pending").OrderByDescending(p => p.CreatedAt).ToListAsync();
        return JsonSerializer.Serialize(proposals.Select(p => new { p.Id, p.Title, p.Description, p.FilePath, p.Status, p.CreatedAt }));
    }
}
