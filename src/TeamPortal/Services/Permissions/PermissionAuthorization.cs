using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace TeamPortal.Services.Permissions;

/// <summary>要求某个权限点（策略名 "perm:&lt;key&gt;" 由 Program 统一注册）</summary>
public sealed class PermissionRequirement(string permission) : IAuthorizationRequirement
{
    public string Permission { get; } = permission;
}

public sealed class PermissionHandler(PermissionService permissions) : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var role = context.User.FindFirstValue(ClaimTypes.Role);
        if (permissions.Has(role, requirement.Permission)) context.Succeed(requirement);
        return Task.CompletedTask;
    }
}
