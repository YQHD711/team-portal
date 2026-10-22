using TeamPortal.Data.Models;
using TeamPortal.Mcp;
using TeamPortal.Services;

namespace api;

/// <summary>
/// 审计 A-03/A-05：MCP 工具与对应 HTTP 端点的**授权对齐**。
/// 部长审批/驳回限申请人所在部门；admin_list_users 不接受调用者覆盖角色/部门。
/// </summary>
public class McpDepartmentAuthorizationTests : McpTestBase
{
    [Fact]
    public async Task ApproveDept_OtherDepartmentLeader_ForbiddenAndRequestUntouched()
    {
        var req = await CreatePendingDeptRequestAsync();
        var tools = new MaterialTools(new MaterialService(Db, Log), Accessor("部长", 4), Log);

        Assert.Equal(McpAuth.Forbidden, await tools.ApproveDept(req.Id));

        await using var check = NewContext();
        Assert.Equal("pending_dept", (await check.CheckoutRequests.FindAsync(req.Id))!.Status);
        Assert.Equal(10, (await check.InventoryItems.FindAsync(1))!.Quantity); // 未扣库存
    }

    [Fact]
    public async Task ApproveDept_SameDepartmentLeader_ApprovesAndWritesAudit()
    {
        var req = await CreatePendingDeptRequestAsync();
        var tools = new MaterialTools(new MaterialService(Db, Log), Accessor("部长", 3, "leader1"), Log);

        var approved = Assert.IsType<CheckoutRequest>(await tools.ApproveDept(req.Id));

        Assert.Equal("approved", approved.Status);
        var audit = await WaitForAuditAsync(o => o.Action == "dept-approve" && o.TargetId == req.Id.ToString());
        Assert.NotNull(audit);
        Assert.Equal(3, audit!.UserId);
    }

    [Fact]
    public async Task Reject_OtherDepartmentLeader_Forbidden()
    {
        var req = await CreatePendingDeptRequestAsync();
        var tools = new MaterialTools(new MaterialService(Db, Log), Accessor("部长", 4), Log);

        Assert.Equal(McpAuth.Forbidden, await tools.RejectRequest(req.Id, "越权驳回"));

        await using var check = NewContext();
        Assert.Equal("pending_dept", (await check.CheckoutRequests.FindAsync(req.Id))!.Status);
    }

    [Fact]
    public async Task Reject_Admin_CanRejectAcrossDepartments()
    {
        // 与 HTTP 对齐：管理员可跨部门驳回，只有"部长"受申请人部门限制
        var req = await CreatePendingDeptRequestAsync();
        var tools = new MaterialTools(new MaterialService(Db, Log), Accessor("admin", 2), Log);

        Assert.Equal("rejected", Assert.IsType<CheckoutRequest>(await tools.RejectRequest(req.Id, "管理员驳回")).Status);
    }

    [Fact]
    public async Task AdminListUsers_MinisterCannotOverrideRoleOrDepartment()
    {
        // 审计 A-05：部长传 role="admin"/dept="图传部" 仍只能看到本部门成员
        var tools = new AdminTools(new AdminService(Db, null!, Log), Accessor("部长", 3, "leader1", "飞控部"));

        var rows = Assert.IsAssignableFrom<IEnumerable<object>>(await tools.ListUsers(role: "admin", dept: "图传部"));

        Assert.Equal(2, rows.Count());   // requester + leader1(自己)，不是全队
    }
}
